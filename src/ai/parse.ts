import { PLATFORMS, normalizeHashtag, type Platform } from '../shared/types.js'

export type GeneratedPost = { text: string; hashtags: string[]; suggestedHashtags: string[] }
export type GenerationResult = Partial<Record<Platform, GeneratedPost>>

/** Models wrap JSON in prose or fences. Pull out the first balanced object. */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidates = [fenced?.[1], raw].filter((s): s is string => Boolean(s))
  for (const c of candidates) {
    const start = c.indexOf('{')
    if (start === -1) continue
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < c.length; i++) {
      const ch = c[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          try {
            return JSON.parse(c.slice(start, i + 1))
          } catch {
            break
          }
        }
      }
    }
  }
  throw new Error('The AI response did not contain valid JSON.')
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === 'string')
    .map(normalizeHashtag)
    .filter(Boolean)
}

/** Tolerant of extra keys, missing platforms, and hashtags baked into the text. */
export function parseGenerationResult(raw: string): GenerationResult {
  const obj = extractJson(raw)
  if (typeof obj !== 'object' || obj === null) throw new Error('The AI response was not an object.')
  const record = obj as Record<string, unknown>
  const out: GenerationResult = {}

  for (const platform of PLATFORMS) {
    const value = record[platform] ?? record[platform.toUpperCase()]
    if (value === undefined) continue
    const node = typeof value === 'string' ? { text: value } : (value as Record<string, unknown>)
    let text = typeof node.text === 'string' ? node.text : ''
    let hashtags = asStringArray(node.hashtags)

    // Strip a trailing hashtag block the model left in the body and fold it in.
    const trailing = text.match(/(?:^|\n)[ \t]*((?:#[\p{L}\p{N}_]+[ \t]*)+)\s*$/u)
    if (trailing?.[1]) {
      const inline = trailing[1].trim().split(/\s+/).map(normalizeHashtag).filter(Boolean)
      text = text.slice(0, trailing.index).trimEnd()
      for (const t of inline) if (!hashtags.some((h) => h.toLowerCase() === t.toLowerCase())) hashtags.push(t)
    }

    const suggested = asStringArray(node.suggestedHashtags ?? node.suggested_hashtags).filter(
      (s) => !hashtags.some((h) => h.toLowerCase() === s.toLowerCase()),
    )
    out[platform] = { text: text.trim(), hashtags, suggestedHashtags: suggested }
  }

  if (Object.keys(out).length === 0) throw new Error('The AI response contained no platform posts.')
  return out
}
