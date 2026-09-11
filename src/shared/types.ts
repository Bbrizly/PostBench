import { z } from 'zod'

export const PLATFORMS = ['linkedin', 'instagram', 'facebook', 'x'] as const
export type Platform = (typeof PLATFORMS)[number]

export const PLATFORM_LABELS: Record<Platform, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
}

export const MediaSchema = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string(),
  type: z.enum(['image', 'video']),
  mime: z.string(),
  size: z.number().nonnegative(),
  description: z.string().default(''),
  durationSec: z.number().nullable().default(null),
})
export type Media = z.infer<typeof MediaSchema>

export const PlatformPostSchema = z.object({
  enabled: z.boolean().default(true),
  text: z.string().default(''),
  hashtags: z.array(z.string()).default([]),
  suggestedHashtags: z.array(z.string()).default([]),
  mediaIds: z.array(z.string()).default([]),
  prepared: z
    .object({
      at: z.string(),
      status: z.enum(['ready', 'partial', 'failed']),
      message: z.string(),
      contentKey: z.string().default(''),
    })
    .nullable()
    .default(null),
  posted: z
    .object({ at: z.string(), url: z.string().nullable(), contentKey: z.string().default('') })
    .nullable()
    .default(null),
})
export type PlatformPost = z.infer<typeof PlatformPostSchema>

export const DraftSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().nonnegative().default(0),
  title: z.string().default('Untitled draft'),
  createdAt: z.string(),
  updatedAt: z.string(),
  source: z.object({ text: z.string().default(''), url: z.string().nullable().default(null) }),
  media: z.array(MediaSchema).default([]),
  platforms: z.object({
    linkedin: PlatformPostSchema,
    instagram: PlatformPostSchema,
    facebook: PlatformPostSchema,
    x: PlatformPostSchema,
  }),
  status: z.enum(['draft', 'prepared', 'posted', 'partial']).default('draft'),
})
export type Draft = z.infer<typeof DraftSchema>

export const BrandSchema = z.object({
  name: z.string(),
  website: z.string().nullable().default(null),
  audience: z.array(z.string()).default([]),
  voice: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
  preferred_phrases: z.array(z.string()).default([]),
})
export type Brand = z.infer<typeof BrandSchema>

export function emptyPlatformPost(): PlatformPost {
  return PlatformPostSchema.parse({})
}

export function newDraft(id: string, text = '', url: string | null = null): Draft {
  const now = new Date().toISOString()
  return DraftSchema.parse({
    id,
    revision: 0,
    title: titleFromText(text),
    createdAt: now,
    updatedAt: now,
    source: { text, url },
    media: [],
    platforms: {
      linkedin: emptyPlatformPost(),
      instagram: emptyPlatformPost(),
      facebook: emptyPlatformPost(),
      x: emptyPlatformPost(),
    },
    status: 'draft',
  })
}

export function titleFromText(text: string): string {
  const t = text.trim().split('\n')[0]?.trim() ?? ''
  if (!t) return 'Untitled draft'
  return t.length > 60 ? `${t.slice(0, 57)}...` : t
}

export function slugId(text: string, date = new Date()): string {
  const day = date.toISOString().slice(0, 10)
  const slug =
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .split('-')
      .filter(Boolean)
      .slice(0, 5)
      .join('-') || 'draft'
  return `${day}-${slug}`
}

/* ---------- hashtags ---------- */

export function normalizeHashtag(tag: string): string {
  return tag.replace(/[^\p{L}\p{N}_]/gu, '')
}

export function addHashtag(tags: string[], tag: string): string[] {
  const clean = normalizeHashtag(tag)
  if (!clean) return tags
  if (tags.some((t) => t.toLowerCase() === clean.toLowerCase())) return tags
  return [...tags, clean]
}

export function removeHashtag(tags: string[], tag: string): string[] {
  return tags.filter((t) => t.toLowerCase() !== tag.toLowerCase())
}

/* ---------- composition & counting ---------- */

/** The exact string that gets typed into a platform composer. */
export function composeText(post: Pick<PlatformPost, 'text' | 'hashtags'>): string {
  const body = post.text.trim()
  if (post.hashtags.length === 0) return body
  const tags = post.hashtags.map((t) => `#${t}`).join(' ')
  return body ? `${body}\n\n${tags}` : tags
}

/** A stable key for the payload handed to a platform composer. */
export function platformContentKey(post: Pick<PlatformPost, 'text' | 'hashtags' | 'mediaIds'>): string {
  return JSON.stringify([composeText(post), post.mediaIds])
}

export function isPreparedCurrent(post: PlatformPost): boolean {
  return Boolean(
    post.prepared?.status === 'ready' && post.prepared.contentKey === platformContentKey(post),
  )
}

export function isPostedCurrent(post: PlatformPost): boolean {
  return Boolean(post.posted && post.posted.contentKey === platformContentKey(post))
}

/** X counts every URL as 23 chars regardless of length. */
export function countCharacters(text: string, platform: Platform): number {
  if (platform !== 'x') return [...text].length
  const urls = text.match(/https?:\/\/\S+/g) ?? []
  let stripped = text
  for (const u of urls) stripped = stripped.replace(u, '')
  return [...stripped].length + urls.length * 23
}

/* ---------- platform rules & validation ---------- */

export type PlatformLimits = {
  maxChars: number
  maxImages: number
  maxVideos: number
  maxMedia?: number
  allowsMixedMedia: boolean
  requiresMedia: boolean
  imageMimes: string[]
  videoMimes: string[]
}

export const PLATFORM_LIMITS: Record<Platform, PlatformLimits> = {
  linkedin: {
    maxChars: 3000,
    maxImages: 20,
    maxVideos: 1,
    allowsMixedMedia: false,
    requiresMedia: false,
    imageMimes: ['image/png', 'image/jpeg', 'image/gif'],
    videoMimes: ['video/mp4', 'video/quicktime'],
  },
  instagram: {
    maxChars: 2200,
    maxImages: 10,
    maxVideos: 10,
    maxMedia: 10,
    allowsMixedMedia: true,
    requiresMedia: true,
    imageMimes: ['image/png', 'image/jpeg'],
    videoMimes: ['video/mp4'],
  },
  facebook: {
    maxChars: 63206,
    maxImages: 10,
    maxVideos: 1,
    allowsMixedMedia: false,
    requiresMedia: false,
    imageMimes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    videoMimes: ['video/mp4', 'video/quicktime'],
  },
  x: {
    maxChars: 280,
    maxImages: 4,
    maxVideos: 1,
    maxMedia: 4,
    allowsMixedMedia: true,
    requiresMedia: false,
    imageMimes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    videoMimes: ['video/mp4'],
  },
}

export type ValidationIssue = { level: 'error' | 'warning'; message: string }

export function compatibleMedia(platform: Platform, media: Media): boolean {
  const limits = PLATFORM_LIMITS[platform]
  return media.type === 'image' ? limits.imageMimes.includes(media.mime) : limits.videoMimes.includes(media.mime)
}

/** Pick a valid starting media set instead of auto-selecting files the platform cannot accept. */
export function defaultMediaSelection(platform: Platform, allMedia: Media[]): string[] {
  const limits = PLATFORM_LIMITS[platform]
  const compatible = allMedia.filter((m) => compatibleMedia(platform, m))
  const picked: Media[] = []
  let images = 0
  let videos = 0

  for (const media of compatible) {
    if (limits.maxMedia !== undefined && picked.length >= limits.maxMedia) break
    if (media.type === 'image') {
      if (images >= limits.maxImages) continue
      if (!limits.allowsMixedMedia && videos > 0) continue
      images++
    } else {
      if (videos >= limits.maxVideos) continue
      if (!limits.allowsMixedMedia && images > 0) continue
      videos++
    }
    picked.push(media)
  }
  return picked.map((m) => m.id)
}

export function validatePlatform(
  platform: Platform,
  post: PlatformPost,
  allMedia: Media[],
): ValidationIssue[] {
  const limits = PLATFORM_LIMITS[platform]
  const label = PLATFORM_LABELS[platform]
  const issues: ValidationIssue[] = []
  const selected = post.mediaIds
    .map((id) => allMedia.find((m) => m.id === id))
    .filter((m): m is Media => Boolean(m))

  const missing = post.mediaIds.length - selected.length
  if (missing > 0)
    issues.push({ level: 'error', message: `${missing} selected file(s) are no longer in the media workspace.` })

  const body = composeText(post)
  if (!body.trim() && selected.length === 0)
    issues.push({ level: 'error', message: `${label} post is empty.` })

  const chars = countCharacters(body, platform)
  if (chars > limits.maxChars)
    issues.push({
      level: 'error',
      message: `${label} allows ${limits.maxChars} characters. This post is ${chars}.`,
    })

  const images = selected.filter((m) => m.type === 'image')
  const videos = selected.filter((m) => m.type === 'video')

  if (limits.requiresMedia && selected.length === 0)
    issues.push({ level: 'error', message: `${label} requires at least one image or video.` })

  if (limits.maxMedia !== undefined && selected.length > limits.maxMedia)
    issues.push({ level: 'error', message: `${label} accepts at most ${limits.maxMedia} media items.` })
  if (images.length > limits.maxImages)
    issues.push({ level: 'error', message: `${label} accepts at most ${limits.maxImages} images.` })
  if (videos.length > limits.maxVideos)
    issues.push({ level: 'error', message: `${label} accepts at most ${limits.maxVideos} video.` })
  if (!limits.allowsMixedMedia && images.length > 0 && videos.length > 0)
    issues.push({
      level: 'error',
      message: `${label} cannot use this media combination — images and video must be posted separately.`,
    })

  for (const m of selected) {
    if (!compatibleMedia(platform, m))
      issues.push({
        level: 'error',
        message: `${label} does not accept ${m.name} (${m.mime}).${
          m.mime === 'video/quicktime' ? ' Convert it to MP4 first.' : ''
        }`,
      })
  }

  if (platform === 'x' && post.hashtags.length > 2)
    issues.push({ level: 'warning', message: 'X posts usually work better with 0–2 hashtags.' })
  if (platform === 'linkedin' && post.hashtags.length > 5)
    issues.push({ level: 'warning', message: 'LinkedIn posts usually work better with 2–5 hashtags.' })

  return issues
}

export function draftStatus(draft: Draft): Draft['status'] {
  const active = PLATFORMS.filter((p) => draft.platforms[p].enabled)
  if (active.length === 0) return 'draft'
  if (active.every((p) => isPostedCurrent(draft.platforms[p]))) return 'posted'
  if (active.some((p) => isPostedCurrent(draft.platforms[p]))) return 'partial'
  if (active.some((p) => isPreparedCurrent(draft.platforms[p]))) return 'prepared'
  return 'draft'
}
