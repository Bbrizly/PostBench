import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { isPreparedCurrent, isPostedCurrent, type Draft } from '../src/shared/types.js'

// Never let the integration suite touch a real browser.
vi.mock('../src/platforms/index.js', () => ({
  preparePlatform: vi.fn(async ({ platform }: { platform: string }) => ({
    platform,
    status: 'ready',
    message: 'Composer filled (mock).',
    details: ['Text inserted'],
  })),
  openComposerOnly: vi.fn(async () => ({ ok: true, message: 'opened (mock)' })),
}))

let tmp: string
let app: import('express').Express

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'postbench-test-'))
  process.env.POSTBENCH_HOME = tmp
  process.env.POSTBENCH_AI_PROVIDER = 'none'
  const { createApp } = await import('../src/server/app.js')
  app = createApp()
})

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

describe('postbench server', () => {
  let draft: Draft

  it('creates a revisioned draft', async () => {
    const res = await request(app).post('/api/drafts').send({ text: 'Faultbench searches manuals offline now.' })
    expect(res.status).toBe(201)
    draft = res.body
    expect(draft.id).toMatch(/^\d{4}-\d{2}-\d{2}-/)
    expect(draft.status).toBe('draft')
    expect(draft.revision).toBe(1)
  })

  it('lists the draft', async () => {
    const res = await request(app).get('/api/drafts')
    expect(res.status).toBe(200)
    expect(res.body.map((d: { id: string }) => d.id)).toContain(draft.id)
  })

  it('saves edits and reloads them', async () => {
    draft.platforms.linkedin.text = 'Edited by hand.'
    draft.platforms.linkedin.hashtags = ['HVAC']
    const put = await request(app).put(`/api/drafts/${draft.id}`).send(draft)
    expect(put.status).toBe(200)
    expect(put.body.revision).toBe(draft.revision + 1)

    const get = await request(app).get(`/api/drafts/${draft.id}`)
    expect(get.body.platforms.linkedin.text).toBe('Edited by hand.')
    expect(get.body.platforms.linkedin.hashtags).toEqual(['HVAC'])
    draft = get.body
  })

  it('rejects a stale full-draft save instead of overwriting newer work', async () => {
    const stale = structuredClone(draft)
    draft.source.text = 'A newer edit'
    const saved = await request(app).put(`/api/drafts/${draft.id}`).send(draft)
    expect(saved.status).toBe(200)
    draft = saved.body

    stale.source.text = 'This stale edit must not win'
    const conflict = await request(app).put(`/api/drafts/${stale.id}`).send(stale)
    expect(conflict.status).toBe(409)
    expect(conflict.body.error).toMatch(/changed since it was loaded/i)

    const current = await request(app).get(`/api/drafts/${draft.id}`)
    expect(current.body.source.text).toBe('A newer edit')
  })

  it('rejects an invalid draft body', async () => {
    const res = await request(app).put(`/api/drafts/${draft.id}`).send({ id: draft.id, nope: true })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Invalid request/)
  })

  it('404s on an unknown draft', async () => {
    const res = await request(app).get('/api/drafts/does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/No draft named/)
  })

  it('uploads media, detects the actual file type, and serves it back', async () => {
    const res = await request(app)
      .post(`/api/drafts/${draft.id}/media`)
      .attach('files', PNG, { filename: 'screenshot.bin', contentType: 'application/octet-stream' })
    expect(res.status).toBe(200)
    draft = res.body.draft
    expect(draft.media).toHaveLength(1)
    expect(draft.media[0]!.type).toBe('image')
    expect(draft.media[0]!.mime).toBe('image/png')

    const file = await request(app).get(`/media/${draft.id}/${draft.media[0]!.id}`)
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toContain('image/png')
  })

  it('does not let a full-draft PUT inject server-owned media paths', async () => {
    const poisoned = structuredClone(draft)
    poisoned.media.push({
      ...poisoned.media[0]!,
      id: 'evil',
      path: '/etc/passwd',
      name: 'passwd',
    })
    const res = await request(app).put(`/api/drafts/${draft.id}`).send(poisoned)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/managed by the media endpoints/i)
  })

  it('reports unsupported file contents instead of trusting the MIME header', async () => {
    const res = await request(app)
      .post(`/api/drafts/${draft.id}/media`)
      .attach('files', Buffer.from('hello'), { filename: 'fake.png', contentType: 'image/png' })
    expect(res.status).toBe(200)
    expect(res.body.errors[0]).toMatch(/not a supported/i)
    expect(res.body.draft.media).toHaveLength(1)
    draft = res.body.draft
  })

  it('generates all four platforms', async () => {
    const res = await request(app).post(`/api/drafts/${draft.id}/generate`).send({})
    expect(res.status).toBe(200)
    expect(res.body.provider).toBe('offline-template')
    draft = res.body.draft
    for (const p of ['linkedin', 'instagram', 'facebook', 'x'] as const)
      expect(draft.platforms[p].text.length).toBeGreaterThan(0)
    expect(draft.platforms.linkedin.mediaIds).toEqual([draft.media[0]!.id])
  })

  it('regenerates one platform without touching the others', async () => {
    const before = structuredClone(draft.platforms)
    const res = await request(app)
      .post(`/api/drafts/${draft.id}/generate`)
      .send({ platforms: ['x'], instruction: 'Make it shorter.', useExisting: true })
    expect(res.status).toBe(200)
    const after = res.body.draft as Draft
    expect(after.platforms.linkedin.text).toBe(before.linkedin.text)
    expect(after.platforms.instagram.text).toBe(before.instagram.text)
    expect(after.platforms.facebook.text).toBe(before.facebook.text)
    draft = after
  })

  it('refuses to generate an empty draft', async () => {
    const blank = (await request(app).post('/api/drafts').send({ text: '' })).body as Draft
    const res = await request(app).post(`/api/drafts/${blank.id}/generate`).send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Write an idea/)
  })

  it('validates per platform', async () => {
    const res = await request(app).get(`/api/drafts/${draft.id}/validate`)
    expect(res.status).toBe(200)
    expect(Object.keys(res.body)).toEqual(['linkedin', 'instagram', 'facebook', 'x'])
  })

  it('blocks prepare when a post is invalid', async () => {
    draft.platforms.x.text = 'a'.repeat(400)
    const saved = await request(app).put(`/api/drafts/${draft.id}`).send(draft)
    expect(saved.status).toBe(200)
    draft = saved.body

    const res = await request(app).post(`/api/drafts/${draft.id}/prepare`).send({ platforms: ['x'] })
    expect(res.status).toBe(400)
    expect(res.body.blocked.x[0]).toMatch(/280 characters/)
  })

  it('prepares valid platforms and records the exact prepared payload', async () => {
    draft.platforms.x.text = 'Short enough.'
    const saved = await request(app).put(`/api/drafts/${draft.id}`).send(draft)
    expect(saved.status).toBe(200)
    draft = saved.body

    const res = await request(app).post(`/api/drafts/${draft.id}/prepare`).send({ platforms: ['linkedin', 'x'] })
    expect(res.status).toBe(200)
    expect(res.body.results.map((r: { platform: string }) => r.platform)).toEqual(['linkedin', 'x'])
    draft = res.body.draft
    expect(draft.platforms.linkedin.prepared?.status).toBe('ready')
    expect(isPreparedCurrent(draft.platforms.linkedin)).toBe(true)
    expect(draft.status).toBe('prepared')
  })

  it('makes preparation stale when the post changes', async () => {
    draft.platforms.linkedin.text += ' changed'
    const saved = await request(app).put(`/api/drafts/${draft.id}`).send(draft)
    expect(saved.status).toBe(200)
    draft = saved.body
    expect(isPreparedCurrent(draft.platforms.linkedin)).toBe(false)
  })

  it('never publishes — prepare only fills composers', async () => {
    const { preparePlatform } = await import('../src/platforms/index.js')
    for (const call of vi.mocked(preparePlatform).mock.calls) expect(call[0]).not.toHaveProperty('publish')
  })

  it('records a manual post against the exact current payload', async () => {
    const res = await request(app)
      .post(`/api/drafts/${draft.id}/posted`)
      .send({ platform: 'linkedin', url: 'https://linkedin.com/posts/123' })
    expect(res.status).toBe(200)
    draft = res.body
    expect(draft.platforms.linkedin.posted?.url).toBe('https://linkedin.com/posts/123')
    expect(isPostedCurrent(draft.platforms.linkedin)).toBe(true)
    expect(draft.status).toBe('partial')
  })

  it('removes media from the workspace and from every platform', async () => {
    const mediaId = draft.media[0]!.id
    const res = await request(app).delete(`/api/drafts/${draft.id}/media/${mediaId}`)
    expect(res.status).toBe(200)
    draft = res.body
    expect(draft.media).toHaveLength(0)
    for (const p of ['linkedin', 'instagram', 'facebook', 'x'] as const)
      expect(draft.platforms[p].mediaIds).not.toContain(mediaId)
  })

  it('reports environment status via doctor', async () => {
    const res = await request(app).get('/api/doctor')
    expect(res.status).toBe(200)
    expect(res.body.home).toBe(tmp)
    expect(res.body.acceptedTypes).toContain('image/png')
  })

  it('deletes a draft', async () => {
    expect((await request(app).delete(`/api/drafts/${draft.id}`)).status).toBe(200)
    expect((await request(app).get(`/api/drafts/${draft.id}`)).status).toBe(404)
  })
})
