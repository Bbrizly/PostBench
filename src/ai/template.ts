import { PLATFORM_LIMITS, normalizeHashtag, type Platform } from '../shared/types.js'
import type { GenerationRequest } from './prompt.js'
import type { GenerationResult } from './parse.js'

const STOP = new Set(
  'the a an and or but for with that this these those from into your you our its it is are was were can now has have had will just about more than then them they what when which who why how'.split(
    ' ',
  ),
)

function keywords(text: string, limit: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []) {
    if (STOP.has(w) || seen.has(w)) continue
    seen.add(w)
    out.push(w)
    if (out.length >= limit) break
  }
  return out
}

function firstSentence(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  const m = t.match(/^(.{20,180}?[.!?])(\s|$)/)
  return (m?.[1] ?? t.slice(0, 180)).trim()
}

function clamp(text: string, platform: Platform): string {
  const max = PLATFORM_LIMITS[platform].maxChars - 40
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

/**
 * Deterministic offline drafts. Not good copy — a starting point you edit.
 * ponytail: intentionally dumb; the real path is an AI adapter.
 */
export function templateGenerate(req: GenerationRequest): GenerationResult {
  const idea = (req.existingText || req.idea).trim()
  const lead = firstSentence(idea)
  const rest = idea.slice(lead.length).trim()
  const brandTag = normalizeHashtag(req.brand.name)
  const kw = keywords(`${idea} ${req.brand.audience.join(' ')}`, 8)
  const tags = [brandTag, ...kw.slice(0, 3).map(normalizeHashtag)].filter(Boolean)
  const suggested = kw.slice(3, 7).map(normalizeHashtag).filter(Boolean)
  const mediaLine = req.media?.length
    ? `\n\n${req.media.map((m) => m.description || m.name).join(' · ')}`
    : ''
  const link = req.url ? `\n\n${req.url}` : ''

  const out: GenerationResult = {}
  for (const p of req.platforms) {
    if (p === 'linkedin')
      out.linkedin = {
        // Lead line, then the detail, then context — the shape LinkedIn reads best in.
        text: clamp(`${lead}\n\n${rest || 'Here is what changed and why it matters.'}${mediaLine}${link}`, p),
        hashtags: tags.slice(0, 4),
        suggestedHashtags: suggested,
      }
    if (p === 'instagram')
      out.instagram = {
        // Visual-first: hook only when there is media to carry the rest.
        text: clamp(`${req.media?.length ? lead : idea.replace(/\s+/g, ' ')}${mediaLine}${link}`, p),
        hashtags: [...tags, ...suggested].slice(0, 8).map((t) => t.toLowerCase()),
        suggestedHashtags: suggested.map((t) => t.toLowerCase()),
      }
    if (p === 'facebook')
      out.facebook = {
        text: clamp(
          `${idea.replace(/\s+/g, ' ')}\n\nIf you deal with this day to day, does it match what you see?${link}`,
          p,
        ),
        hashtags: [],
        suggestedHashtags: tags,
      }
    if (p === 'x')
      out.x = {
        text: clamp(`${lead}${link}`, p),
        hashtags: tags.slice(0, 1),
        suggestedHashtags: suggested.slice(0, 3),
      }
  }
  return out
}
