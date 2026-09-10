import { selectAdapter, AiUnavailableError, type Adapter } from './adapters.js'
import { buildPrompt, type GenerationRequest } from './prompt.js'
import { parseGenerationResult, type GenerationResult } from './parse.js'
import { templateGenerate } from './template.js'

export type ContentGenerator = (req: GenerationRequest) => Promise<GenerationOutcome>
export type GenerationOutcome = { result: GenerationResult; provider: string; note?: string }

export async function generateContent(
  req: GenerationRequest,
  adapter: Adapter | null = selectAdapter(),
): Promise<GenerationOutcome> {
  if (!adapter) {
    return {
      result: templateGenerate(req),
      provider: 'offline-template',
      note: 'No AI provider configured — these are plain offline drafts. Run `postbench doctor` to set one up.',
    }
  }
  try {
    const raw = await adapter.complete(buildPrompt(req))
    return { result: parseGenerationResult(raw), provider: adapter.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof AiUnavailableError)
      return {
        result: templateGenerate(req),
        provider: 'offline-template',
        note: `${message} Falling back to offline drafts.`,
      }
    throw new Error(`Generation failed (${adapter.id}): ${message}`)
  }
}

export { buildPrompt, parseGenerationResult, templateGenerate }
export type { GenerationRequest, GenerationResult }
