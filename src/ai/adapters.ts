import { spawn } from 'node:child_process'

export type Adapter = {
  id: string
  label: string
  complete(prompt: string): Promise<string>
}

export class AiUnavailableError extends Error {}

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function retryDelay(res: Response | null, attempt: number): number {
  const retryAfter = res?.headers.get('retry-after')
  const seconds = retryAfter ? Number(retryAfter) : NaN
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 5000)
  return 400 * 2 ** attempt
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

async function fetchWithRetry(url: string, init: RequestInit, label: string): Promise<Response> {
  const attempts = 3
  let lastNetworkError: unknown = null

  for (let attempt = 0; attempt < attempts; attempt++) {
    let res: Response | null = null
    try {
      res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(envInt('POSTBENCH_AI_TIMEOUT_MS', 180_000)),
      })
    } catch (err) {
      lastNetworkError = err
      if (attempt < attempts - 1) {
        await sleep(retryDelay(null, attempt))
        continue
      }
      break
    }

    if (res.ok) return res
    const detail = (await res.text()).trim().slice(0, 1200)
    if (retryableStatus(res.status) && attempt < attempts - 1) {
      await sleep(retryDelay(res, attempt))
      continue
    }
    throw new Error(`${label} error ${res.status}${detail ? `: ${detail}` : ''}`)
  }

  const message = lastNetworkError instanceof Error ? lastNetworkError.message : String(lastNetworkError ?? 'request failed')
  throw new Error(`${label} request failed after ${attempts} attempts: ${message}`)
}

/** Uses the already-authenticated Claude Code CLI. No API key needed. */
export const claudeCliAdapter: Adapter = {
  id: 'claude-cli',
  label: 'Claude Code CLI (claude -p)',
  async complete(prompt) {
    const bin = process.env.POSTBENCH_CLAUDE_BIN || 'claude'
    return new Promise((resolve, reject) => {
      const child = spawn(bin, ['-p', '--output-format', 'text'], { stdio: ['pipe', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error('The Claude CLI took too long to respond.'))
      }, envInt('POSTBENCH_AI_TIMEOUT_MS', 180_000))
      child.stdout.on('data', (d) => (out += d))
      child.stderr.on('data', (d) => (err += d))
      child.on('error', (e) =>
        reject(new AiUnavailableError(`Could not run "${bin}": ${(e as Error).message}`)),
      )
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve(out)
        else reject(new Error(err.trim() || `claude exited with code ${code}`))
      })
      child.stdin.end(prompt)
    })
  },
}

export const anthropicAdapter: Adapter = {
  id: 'anthropic',
  label: 'Anthropic API',
  async complete(prompt) {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) throw new AiUnavailableError('ANTHROPIC_API_KEY is not set.')
    const res = await fetchWithRetry(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: process.env.POSTBENCH_AI_MODEL || 'claude-sonnet-5',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        }),
      },
      'Anthropic API',
    )
    const json = (await res.json()) as { content?: { type: string; text?: string }[] }
    const text = json.content?.map((c) => c.text ?? '').join('') ?? ''
    if (!text.trim()) throw new Error('Anthropic API returned an empty response.')
    return text
  },
}

export const openaiAdapter: Adapter = {
  id: 'openai',
  label: 'OpenAI API',
  async complete(prompt) {
    const key = process.env.OPENAI_API_KEY
    if (!key) throw new AiUnavailableError('OPENAI_API_KEY is not set.')
    const res = await fetchWithRetry(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: process.env.POSTBENCH_AI_MODEL || 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
        }),
      },
      'OpenAI API',
    )
    const json = (await res.json()) as { choices?: { message?: { content?: string | null } }[] }
    const text = json.choices?.[0]?.message?.content ?? ''
    if (!text.trim()) throw new Error('OpenAI API returned an empty response.')
    return text
  },
}

export const ollamaAdapter: Adapter = {
  id: 'ollama',
  label: 'Ollama (local)',
  async complete(prompt) {
    const host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'
    let res: Response
    try {
      res = await fetchWithRetry(
        `${host}/api/generate`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: process.env.POSTBENCH_AI_MODEL || 'llama3.1',
            prompt,
            stream: false,
          }),
        },
        'Ollama',
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (/request failed after|fetch failed|ECONNREFUSED|not reachable/i.test(message))
        throw new AiUnavailableError(`Ollama is not reachable at ${host}.`)
      throw err
    }
    const text = ((await res.json()) as { response?: string }).response ?? ''
    if (!text.trim()) throw new Error('Ollama returned an empty response.')
    return text
  },
}

export const ADAPTERS: Record<string, Adapter> = {
  'claude-cli': claudeCliAdapter,
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  ollama: ollamaAdapter,
}

/** Explicit env choice wins; otherwise pick whatever this machine can actually do. */
export function selectAdapter(): Adapter | null {
  const forced = process.env.POSTBENCH_AI_PROVIDER
  if (forced) {
    if (forced === 'none') return null
    const a = ADAPTERS[forced]
    if (!a) throw new Error(`Unknown POSTBENCH_AI_PROVIDER "${forced}".`)
    return a
  }
  if (process.env.ANTHROPIC_API_KEY) return anthropicAdapter
  if (process.env.OPENAI_API_KEY) return openaiAdapter
  return claudeCliAdapter
}
