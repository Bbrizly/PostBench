import { PLATFORMS, normalizeHashtag, type Platform } from '../shared/types.js'

export type GeneratedPost = { text: string; hashtags: string[]; suggestedHashtags: string[] }
export type GenerationResult = Partial<Record<Platform, GeneratedPost>>

/** Models sometimes wrap JSON in prose or fences. Pull out the first balanced object. */
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

function uniqueTags(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of v) {
    if (typeof value !== 'string') continue
    const clean = normalizeHashtag(value)
    const key = clean.toLowerCase()
    if (!clean || seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= 20) break
  }
  return out
}

/** Tolerant of harmless formatting mistakes, strict about requested platform completeness. */
export function parseGenerationResult(raw: string, requiredPlatforms: Platform[] = []): GenerationResult {
  const obj = extractJson(raw)
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) throw new Error('The AI response was not an object.')
  const record = obj as Record<string, unknown>
  const out: GenerationResult = {}

  for (const platform of PLATFORMS) {
    const value = record[platform] ?? record[platform.toUpperCase()]
    if (value === undefined) continue
    if (typeof value !== 'string' && (typeof value !== 'object' || value === null || Array.isArray(value))) continue

    const node = typeof value === 'string' ? { text: value } : (value as Record<string, unknown>)
    let text = typeof node.text === 'string' ? node.text : ''
    const hashtags = uniqueTags(node.hashtags)

    // Strip a trailing hashtag block the model left in the body and fold it in.
    const trailing = text.match(/(?:^|\n)[ \t]*((?:#[\p{L}\p{N}_]+[ \t]*)+)\s*$/u)
    if (trailing?.[1]) {
      const inline = trailing[1].trim().split(/\s+/).map(normalizeHashtag).filter(Boolean)
      text = text.slice(0, trailing.index).trimEnd()
      for (const tag of inline) {
        if (!hashtags.some((h) => h.toLowerCase() === tag.toLowerCase())) hashtags.push(tag)
      }
    }

    const suggested = uniqueTags(node.suggestedHashtags ?? node.suggested_hashtags)
      .filter((s) => !hashtags.some((h) => h.toLowerCase() === s.toLowerCase()))
      .slice(0, 5)

    if (!text.trim()) continue
    out[platform] = { text: text.trim(), hashtags, suggestedHashtags: suggested }
  }

  const missing = requiredPlatforms.filter((platform) => !out[platform])
  if (missing.length) throw new Error(`The AI response was missing valid posts for: ${missing.join(', ')}.`)
  if (Object.keys(out).length === 0) throw new Error('The AI response contained no platform posts.')
  return out
}
