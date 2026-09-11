import type { BrowserContext, Page } from 'playwright'
import type { Platform } from '../shared/types.js'
import { profileDir } from '../server/store.js'

export class BrowserUnavailableError extends Error {}

let context: BrowserContext | null = null
const platformPages = new Map<Platform, Page>()

/**
 * One persistent Chromium profile, reused for the life of the server process.
 * The user logs into the platforms in this window by hand; we never touch credentials.
 */
export async function getContext(): Promise<BrowserContext> {
  if (context) return context
  let chromium: typeof import('playwright').chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    throw new BrowserUnavailableError('Playwright is not installed. Run: npm i && npx playwright install chromium')
  }
  try {
    context = await chromium.launchPersistentContext(profileDir(), {
      headless: false,
      viewport: null,
      args: ['--start-maximized'],
    })
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    if (/already in use|existing browser session|ProcessSingleton/i.test(raw))
      throw new BrowserUnavailableError(
        'The Postbench browser profile is already open in another window. Close that window (or the other Postbench instance) and try again.',
      )
    if (/Executable doesn't exist|browserType\.launch: /i.test(raw))
      throw new BrowserUnavailableError(
        'The Postbench browser is not installed yet. Run: npx playwright install chromium',
      )
    throw new BrowserUnavailableError(`Could not launch the Postbench browser. ${raw.split('\n')[0]}`)
  }
  context.on('close', () => {
    context = null
    platformPages.clear()
  })
  return context
}

export async function closeContext(): Promise<void> {
  await context?.close().catch(() => {})
  context = null
  platformPages.clear()
}

/** Reuse one tab per platform so repeated prepares do not leave a trail of stale composer tabs. */
export async function getPlatformPage(platform: Platform): Promise<Page> {
  const existing = platformPages.get(platform)
  if (existing && !existing.isClosed()) {
    try {
      await existing.bringToFront()
      return existing
    } catch {
      platformPages.delete(platform)
    }
  }

  const ctx = await getContext()
  const page = await ctx.newPage()
  page.setDefaultTimeout(20_000)
  platformPages.set(platform, page)
  page.on('close', () => {
    if (platformPages.get(platform) === page) platformPages.delete(platform)
  })
  return page
}

/** Returns the first locator that actually shows up, or null. Never clicks blindly. */
export async function firstVisible(page: Page, selectors: string[], timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first()
      if (await loc.isVisible().catch(() => false)) return loc
    }
    await page.waitForTimeout(250)
  }
  return null
}

export async function waitForCount(page: Page, selector: string, expected: number, timeoutMs = 30_000): Promise<boolean> {
  if (expected <= 0) return true
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const count = await page.locator(selector).count().catch(() => 0)
    if (count >= expected) return true
    await page.waitForTimeout(250)
  }
  return false
}

export function normalizeComposerText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Platforms bounce logged-out users through a lot of different URLs. */
export async function looksLikeLogin(page: Page): Promise<boolean> {
  const url = page.url()
  if (/(\/login|\/signup|\/checkpoint|\/challenge|\/onboarding|\/i\/flow\/|mode=login|redirect_after_login)/i.test(url))
    return true
  if ((await page.locator('input[type="password"]').count().catch(() => 0)) > 0) return true
  return (await page.getByRole('button', { name: /^(sign in|log in)$/i }).count().catch(() => 0)) > 0
}
