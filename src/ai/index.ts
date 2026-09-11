import { PLATFORM_LIMITS, composeText, countCharacters } from '../shared/types.js'
import { selectAdapter, AiUnavailableError, type Adapter } from './adapters.js'
import { buildPrompt, type GenerationRequest } from './prompt.js'
import { parseGenerationResult, type GenerationResult } from './parse.js'
import { templateGenerate } from './template.js'

export type ContentGenerator = (req: GenerationRequest) => Promise<GenerationOutcome>
export type GenerationOutcome = { result: GenerationResult; provider: string; note?: string }

function parseAndValidate(req: GenerationRequest, raw: string): GenerationResult {
  const result = parseGenerationResult(raw, req.platforms)
  for (const platform of req.platforms) {
    const post = result[platform]!
    const count = countCharacters(composeText(post), platform)
    if (count > PLATFORM_LIMITS[platform].maxChars)
      throw new Error(
        `${platform} is ${count} characters, over the ${PLATFORM_LIMITS[platform].maxChars}-character limit.`,
      )
  }
  return result
}

function repairPrompt(originalPrompt: string, raw: string, error: string): string {
  return `${originalPrompt}\n\n## CORRECTION REQUIRED\nYour previous JSON failed validation: ${error}\nFix only the format/constraint problem. Preserve supported facts and return the complete corrected JSON object only.\n\nPrevious response:\n${raw.slice(0, 6000)}`
}

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

  const prompt = buildPrompt(req)
  let raw: string
  try {
    raw = await adapter.complete(prompt)
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

  try {
    return { result: parseAndValidate(req, raw), provider: adapter.id }
  } catch (firstError) {
    const reason = firstError instanceof Error ? firstError.message : String(firstError)
    try {
      const repaired = await adapter.complete(repairPrompt(prompt, raw, reason))
      return {
        result: parseAndValidate(req, repaired),
        provider: adapter.id,
        note: 'The first AI response was invalid, so Postbench repaired it once before using it.',
      }
    } catch (repairError) {
      const message = repairError instanceof Error ? repairError.message : String(repairError)
      throw new Error(`Generation failed (${adapter.id}): ${reason} Repair attempt also failed: ${message}`)
    }
  }
}

export { buildPrompt, parseGenerationResult, templateGenerate }
export type { GenerationRequest, GenerationResult }
