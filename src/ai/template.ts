import {
  PLATFORM_LIMITS,
  composeText,
  countCharacters,
  normalizeHashtag,
  type Platform,
} from '../shared/types.js'
import type { GenerationRequest } from './prompt.js'
import type { GeneratedPost, GenerationResult } from './parse.js'

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
  const normalized = text.trim().replace(/\s+/g, ' ')
  const m = normalized.match(/^(.{20,180}?[.!?])(\s|$)/)
  return (m?.[1] ?? normalized.slice(0, 180)).trim()
}

function offlineRewrite(text: string, instruction?: string): string {
  if (!instruction) return text
  if (/shorter/i.test(instruction)) return firstSentence(text)
  if (/less promotional/i.test(instruction))
    return text
      .replace(/\b(thrilled|excited|revolutionary|game-changing)\b/gi, '')
      .replace(/!+/g, '.')
      .replace(/\s{2,}/g, ' ')
      .trim()
  // A deterministic fallback cannot safely invent extra technical detail or reliably change voice.
  return text
}

function fitPost(platform: Platform, post: GeneratedPost): GeneratedPost {
  const hashtags = [...post.hashtags]
  let text = post.text.trim()
  const max = PLATFORM_LIMITS[platform].maxChars

  while (countCharacters(composeText({ text, hashtags }), platform) > max && hashtags.length > 0) hashtags.pop()
  if (countCharacters(composeText({ text, hashtags }), platform) <= max) return { ...post, text, hashtags }

  let over = countCharacters(composeText({ text, hashtags }), platform) - max
  while (over > 0 && text.length > 1) {
    text = `${text.slice(0, Math.max(1, text.length - over - 1)).trimEnd()}…`
    over = countCharacters(composeText({ text, hashtags }), platform) - max
  }
  return { ...post, text, hashtags }
}

/** Deterministic offline drafts. Intentionally plain; the real writing path is an AI adapter. */
export function templateGenerate(req: GenerationRequest): GenerationResult {
  const rawIdea = (req.existingText || req.idea).trim()
  const idea = offlineRewrite(rawIdea, req.instruction).replace(/\s+/g, ' ').trim()
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
    let post: GeneratedPost
    if (p === 'linkedin')
      post = {
        text: `${lead}\n\n${rest || 'Here is what changed and why it matters.'}${mediaLine}${link}`,
        hashtags: tags.slice(0, 4),
        suggestedHashtags: suggested,
      }
    else if (p === 'instagram')
      post = {
        text: `${req.media?.length ? lead : idea}${mediaLine}${link}`,
        hashtags: [...tags, ...suggested].slice(0, 8).map((t) => t.toLowerCase()),
        suggestedHashtags: suggested.map((t) => t.toLowerCase()),
      }
    else if (p === 'facebook')
      post = {
        text: `${idea}\n\nWhat do you think?${link}`,
        hashtags: [],
        suggestedHashtags: tags,
      }
    else
      post = {
        text: `${lead}${link}`,
        hashtags: tags.slice(0, 1),
        suggestedHashtags: suggested.slice(0, 3),
      }

    out[p] = fitPost(p, post)
  }
  return out
}
