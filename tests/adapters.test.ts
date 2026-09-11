import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Adapter runner tests use a fake page. They never open a browser and never
 * reach a social platform, so they can never create a real post.
 */

const calls: string[] = []
let loggedOut = false
const fakePage = { url: () => 'https://example.test/' }

vi.mock('../src/platforms/browser.js', () => ({
  BrowserUnavailableError: class extends Error {},
  getPlatformPage: vi.fn(async () => fakePage),
  looksLikeLogin: vi.fn(async () => loggedOut),
  firstVisible: vi.fn(async () => null),
  waitForCount: vi.fn(async () => true),
  normalizeComposerText: (text: string) => text.trim(),
  getContext: vi.fn(),
  closeContext: vi.fn(),
}))

const fakeAdapter = (id: string, mediaFirst = false) => ({
  id,
  composerUrl: 'https://example.test/',
  mediaFirst,
  openComposer: vi.fn(async () => void calls.push('open')),
  setText: vi.fn(async () => void calls.push('text')),
  uploadMedia: vi.fn(async () => void calls.push('media')),
  checkReady: vi.fn(async () => ({ platform: id, status: 'ready', message: 'ok', details: ['Exact text verified'] })),
})

describe('prepare runner', () => {
  beforeEach(() => {
    calls.length = 0
    loggedOut = false
    vi.resetModules()
  })

  it('fills text before media by default and verifies the expected payload', async () => {
    const { preparePlatform, ADAPTERS } = await import('../src/platforms/index.js')
    const original = ADAPTERS.linkedin
    const adapter = fakeAdapter('linkedin')
    // @ts-expect-error test double
    ADAPTERS.linkedin = adapter
    const result = await preparePlatform({ platform: 'linkedin', text: 'hi', mediaPaths: ['/tmp/a.png'] })
    expect(calls).toEqual(['open', 'text', 'media'])
    expect(result.status).toBe('ready')
    expect(adapter.checkReady).toHaveBeenCalledWith(fakePage, { text: 'hi', mediaCount: 1 })
    ADAPTERS.linkedin = original
  })

  it('uploads media before the caption on Instagram', async () => {
    const { preparePlatform, ADAPTERS } = await import('../src/platforms/index.js')
    const original = ADAPTERS.instagram
    // @ts-expect-error test double
    ADAPTERS.instagram = fakeAdapter('instagram', true)
    await preparePlatform({ platform: 'instagram', text: 'hi', mediaPaths: ['/tmp/a.png'] })
    expect(calls).toEqual(['open', 'media', 'text'])
    ADAPTERS.instagram = original
  })

  it('reports an unverifiable composer instead of throwing a stack trace', async () => {
    const mod = await import('../src/platforms/index.js')
    const original = mod.ADAPTERS.x
    const broken = fakeAdapter('x')
    broken.openComposer = vi.fn(async () => {
      throw new mod.ComposerNotFoundError('Could not find the composer.')
    })
    // @ts-expect-error test double
    mod.ADAPTERS.x = broken
    const result = await mod.preparePlatform({ platform: 'x', text: 'hi', mediaPaths: [] })
    expect(result.status).toBe('failed')
    expect(result.message).toMatch(/could not be verified/)
    expect(result.message).not.toMatch(/at .*\.ts:/)
    mod.ADAPTERS.x = original
  })

  it('reports login required when the page is a login wall', async () => {
    loggedOut = true
    const mod = await import('../src/platforms/index.js')
    const original = mod.ADAPTERS.facebook
    const broken = fakeAdapter('facebook')
    broken.openComposer = vi.fn(async () => {
      throw new mod.ComposerNotFoundError('no composer')
    })
    // @ts-expect-error test double
    mod.ADAPTERS.facebook = broken
    const result = await mod.preparePlatform({ platform: 'facebook', text: 'hi', mediaPaths: [] })
    expect(result.status).toBe('login')
    mod.ADAPTERS.facebook = original
  })

  it('has no publish method anywhere — publishing stays manual', async () => {
    vi.doUnmock('../src/platforms/browser.js')
    vi.resetModules()
    const { ADAPTERS } = await import('../src/platforms/index.js')
    for (const adapter of Object.values(ADAPTERS)) {
      expect(adapter).not.toHaveProperty('publish')
      expect(Object.keys(adapter)).toEqual(
        expect.arrayContaining(['openComposer', 'setText', 'uploadMedia', 'checkReady']),
      )
    }
  })
})
