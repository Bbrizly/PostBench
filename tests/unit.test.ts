import { describe, expect, it } from 'vitest'
import {
  DraftSchema,
  addHashtag,
  removeHashtag,
  composeText,
  countCharacters,
  newDraft,
  slugId,
  validatePlatform,
  draftStatus,
  emptyPlatformPost,
  type Media,
} from '../src/shared/types.js'
import { parseGenerationResult, extractJson } from '../src/ai/parse.js'
import { templateGenerate } from '../src/ai/template.js'
import example from '../examples/example-draft.json'

const image = (id: string, mime = 'image/png'): Media => ({
  id,
  path: `/tmp/${id}.png`,
  name: `${id}.png`,
  type: 'image',
  mime,
  size: 1000,
  description: '',
  durationSec: null,
})
const video = (id: string, mime = 'video/mp4'): Media => ({
  id,
  path: `/tmp/${id}.mp4`,
  name: `${id}.mp4`,
  type: 'video',
  mime,
  size: 1000,
  description: '',
  durationSec: 19,
})

describe('draft validation', () => {
  it('accepts the shipped example draft', () => {
    expect(() => DraftSchema.parse(example)).not.toThrow()
  })

  it('rejects a draft missing a platform', () => {
    const bad = { ...structuredClone(example), platforms: { linkedin: example.platforms.linkedin } }
    expect(() => DraftSchema.parse(bad)).toThrow()
  })

  it('fills defaults for a new draft', () => {
    const d = newDraft('x', 'Hello there')
    expect(d.status).toBe('draft')
    expect(d.platforms.x.enabled).toBe(true)
    expect(d.title).toBe('Hello there')
  })

  it('builds a dated slug id', () => {
    expect(slugId('Faultbench can now search manuals offline', new Date('2026-09-10T00:00:00Z'))).toBe(
      '2026-09-10-faultbench-can-now-search-manuals',
    )
  })
})

describe('hashtags', () => {
  it('adds, dedupes case-insensitively, and strips punctuation', () => {
    let tags = addHashtag([], '#HVAC')
    tags = addHashtag(tags, 'hvac')
    tags = addHashtag(tags, 'Field Service')
    expect(tags).toEqual(['HVAC', 'FieldService'])
  })

  it('ignores empty tags', () => {
    expect(addHashtag(['A'], '###')).toEqual(['A'])
  })

  it('removes case-insensitively', () => {
    expect(removeHashtag(['HVAC', 'Trades'], 'hvac')).toEqual(['Trades'])
  })
})

describe('character counting', () => {
  it('appends hashtags to the composed text', () => {
    expect(composeText({ text: 'Hello', hashtags: ['A', 'B'] })).toBe('Hello\n\n#A #B')
  })

  it('counts hashtags toward the total', () => {
    expect(countCharacters(composeText({ text: 'Hello', hashtags: ['HVAC'] }), 'linkedin')).toBe(12)
  })

  it('counts a URL as 23 characters on X only', () => {
    const text = `see https://example.com/${'a'.repeat(100)}`
    expect(countCharacters(text, 'x')).toBe(4 + 23)
    expect(countCharacters(text, 'linkedin')).toBe(text.length)
  })
})

describe('platform validation', () => {
  it('flags an over-length X post', () => {
    const issues = validatePlatform('x', { ...emptyPlatformPost(), text: 'a'.repeat(300) }, [])
    expect(issues.some((i) => i.level === 'error' && i.message.includes('280'))).toBe(true)
  })

  it('rejects mixing images and video on X', () => {
    const issues = validatePlatform(
      'x',
      { ...emptyPlatformPost(), text: 'hi', mediaIds: ['a', 'b'] },
      [image('a'), video('b')],
    )
    expect(issues.some((i) => i.message.includes('cannot use this media combination'))).toBe(true)
  })

  it('requires media on Instagram', () => {
    const issues = validatePlatform('instagram', { ...emptyPlatformPost(), text: 'hi' }, [])
    expect(issues.some((i) => i.message.includes('requires at least one'))).toBe(true)
  })

  it('rejects an unsupported mime and suggests conversion', () => {
    const issues = validatePlatform(
      'instagram',
      { ...emptyPlatformPost(), text: 'hi', mediaIds: ['v'] },
      [video('v', 'video/quicktime')],
    )
    expect(issues.some((i) => i.message.includes('Convert it to MP4'))).toBe(true)
  })

  it('caps X at four images', () => {
    const media = ['a', 'b', 'c', 'd', 'e'].map((i) => image(i))
    const issues = validatePlatform('x', { ...emptyPlatformPost(), text: 'hi', mediaIds: media.map((m) => m.id) }, media)
    expect(issues.some((i) => i.message.includes('at most 4 images'))).toBe(true)
  })

  it('passes a valid LinkedIn post', () => {
    const issues = validatePlatform(
      'linkedin',
      { ...emptyPlatformPost(), text: 'A real post.', hashtags: ['HVAC'], mediaIds: ['a'] },
      [image('a')],
    )
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
  })

  it('notices media that was deleted from the workspace', () => {
    const issues = validatePlatform('linkedin', { ...emptyPlatformPost(), text: 'hi', mediaIds: ['gone'] }, [])
    expect(issues.some((i) => i.message.includes('no longer in the media workspace'))).toBe(true)
  })
})

describe('draft status', () => {
  it('reports prepared, partial and posted', () => {
    const d = newDraft('d', 'idea')
    for (const p of ['instagram', 'facebook', 'x'] as const) d.platforms[p].enabled = false
    expect(draftStatus(d)).toBe('draft')

    d.platforms.linkedin.prepared = { at: 'now', status: 'ready', message: '' }
    expect(draftStatus(d)).toBe('prepared')

    d.platforms.x.enabled = true
    d.platforms.linkedin.posted = { at: 'now', url: null }
    expect(draftStatus(d)).toBe('partial')

    d.platforms.x.posted = { at: 'now', url: null }
    expect(draftStatus(d)).toBe('posted')
  })
})

describe('generation result parsing', () => {
  it('parses clean JSON', () => {
    const out = parseGenerationResult(
      JSON.stringify({ linkedin: { text: 'a', hashtags: ['HVAC'], suggestedHashtags: ['Trades'] } }),
    )
    expect(out.linkedin).toEqual({ text: 'a', hashtags: ['HVAC'], suggestedHashtags: ['Trades'] })
  })

  it('parses JSON wrapped in prose and fences', () => {
    const out = parseGenerationResult('Sure!\n```json\n{"x": {"text": "hi", "hashtags": []}}\n```\nHope that helps.')
    expect(out.x?.text).toBe('hi')
  })

  it('folds a trailing hashtag block out of the body', () => {
    const out = parseGenerationResult(JSON.stringify({ instagram: { text: 'Caption here.\n\n#hvac #trades', hashtags: [] } }))
    expect(out.instagram?.text).toBe('Caption here.')
    expect(out.instagram?.hashtags).toEqual(['hvac', 'trades'])
  })

  it('strips the # from hashtags and drops duplicate suggestions', () => {
    const out = parseGenerationResult(
      JSON.stringify({ x: { text: 'hi', hashtags: ['#HVAC'], suggestedHashtags: ['hvac', 'Trades'] } }),
    )
    expect(out.x?.hashtags).toEqual(['HVAC'])
    expect(out.x?.suggestedHashtags).toEqual(['Trades'])
  })

  it('throws readable errors on garbage', () => {
    expect(() => parseGenerationResult('no json at all')).toThrow(/valid JSON/)
    expect(() => parseGenerationResult('{"twitter": {}}')).toThrow(/no platform posts/)
  })

  it('extracts a balanced object containing braces inside strings', () => {
    expect(extractJson('{"a": "} not the end"}')).toEqual({ a: '} not the end' })
  })
})

describe('offline template generation', () => {
  const req = {
    idea: 'Faultbench can now search HVAC manuals completely offline. It works with no signal.',
    brand: { name: 'Faultbench', website: null, audience: ['HVAC technicians'], voice: [], avoid: [], preferred_phrases: [] },
    platforms: ['linkedin', 'instagram', 'facebook', 'x'] as const,
  }

  it('produces different text per platform', () => {
    const out = templateGenerate({ ...req, platforms: [...req.platforms] })
    const texts = Object.values(out).map((p) => p!.text)
    expect(new Set(texts).size).toBe(texts.length)
  })

  it('stays inside every platform limit', () => {
    const out = templateGenerate({ ...req, platforms: [...req.platforms] })
    for (const p of req.platforms) {
      const post = out[p]!
      expect(countCharacters(composeText(post), p)).toBeLessThanOrEqual(
        p === 'x' ? 280 : p === 'instagram' ? 2200 : 3000,
      )
    }
  })
})
