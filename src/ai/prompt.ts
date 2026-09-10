import { PLATFORM_LIMITS, type Brand, type Platform } from '../shared/types.js'

export type GenerationRequest = {
  idea: string
  url?: string | null
  media?: { name: string; type: 'image' | 'video'; description?: string }[]
  brand: Brand
  platforms: Platform[]
  /** Free-text nudge for regeneration, e.g. "Make it shorter." */
  instruction?: string
  /** Existing text to transform instead of writing from scratch. */
  existingText?: string
}

const PLATFORM_STYLE: Record<Platform, string> = {
  linkedin: `Thoughtful, building-in-public, practical. Short paragraphs with blank lines between them.
Give a little context — what changed and why it matters to the reader.
Banned openers and phrases: "I'm thrilled", "excited to announce", "revolutionary", "game-changing", "unlock", "leverage".
No inspirational filler. At most one emoji, usually none. 2-5 hashtags.`,
  instagram: `Visual-first caption for the attached media. Strong, concrete first line that works as a hook.
Short, casual, concrete. A few line breaks are fine. Under 600 characters.
5-10 relevant hashtags, lowercase, no spammy blocks.`,
  facebook: `Conversational and natural, like explaining it to a friend who is in the trade.
No startup vocabulary. Slightly longer is fine. 0-2 hashtags, usually zero.`,
  x: `One post, not a thread. Concise and punchy, strong first sentence.
Hard limit ${PLATFORM_LIMITS.x.maxChars} characters INCLUDING hashtags. 0-2 hashtags.`,
}

export function buildPrompt(req: GenerationRequest): string {
  const b = req.brand
  const lines: string[] = []

  lines.push(
    'You are a social copywriter. Write platform-native posts. Return ONLY JSON, no commentary, no markdown fences.',
  )
  lines.push('')
  lines.push('## Brand')
  lines.push(`Name: ${b.name}`)
  if (b.website) lines.push(`Website: ${b.website}`)
  if (b.audience.length) lines.push(`Audience: ${b.audience.join(', ')}`)
  if (b.voice.length) lines.push(`Voice: ${b.voice.join(', ')}`)
  if (b.avoid.length) lines.push(`Never use: ${b.avoid.join(', ')}`)
  if (b.preferred_phrases.length)
    lines.push(`Phrases that fit the brand (use only if natural): ${b.preferred_phrases.join(' | ')}`)

  lines.push('')
  lines.push('## What to post about')
  lines.push(req.idea.trim() || '(no idea text supplied — rely on the media descriptions)')
  if (req.url) lines.push(`Link to include: ${req.url}`)

  if (req.media?.length) {
    lines.push('')
    lines.push('## Attached media (the copy must make sense next to these)')
    for (const m of req.media)
      lines.push(`- ${m.name} (${m.type})${m.description ? `: ${m.description}` : ''}`)
  }

  if (req.existingText) {
    lines.push('')
    lines.push('## Existing post to rewrite (keep the same facts)')
    lines.push(req.existingText)
  }
  if (req.instruction) {
    lines.push('')
    lines.push(`## Instruction`)
    lines.push(req.instruction)
  }

  lines.push('')
  lines.push('## Rules')
  lines.push('- Never produce the same text for two platforms. Rewrite for each one.')
  lines.push('- Put hashtags in the "hashtags" array only. Do NOT put "#tag" inside "text".')
  lines.push('- Hashtags are bare words without the "#".')
  lines.push('- Plain text only. No markdown.')

  lines.push('')
  lines.push('## Platforms')
  for (const p of req.platforms) {
    lines.push(`### ${p}`)
    lines.push(PLATFORM_STYLE[p])
    lines.push(`Max ${PLATFORM_LIMITS[p].maxChars} characters including hashtags.`)
  }

  lines.push('')
  lines.push('## Output shape')
  lines.push(
    JSON.stringify(
      Object.fromEntries(
        req.platforms.map((p) => [p, { text: 'string', hashtags: ['string'], suggestedHashtags: ['string'] }]),
      ),
      null,
      2,
    ),
  )
  lines.push('"suggestedHashtags" are 3-5 extra relevant tags I might add, not already in "hashtags".')

  return lines.join('\n')
}
