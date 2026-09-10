import { PLATFORM_LABELS, type Platform } from '../shared/types.js'
import { BrowserUnavailableError, looksLikeLogin, newPage } from './browser.js'
import { linkedin } from './linkedin.js'
import { instagram } from './instagram.js'
import { facebook } from './facebook.js'
import { x } from './x.js'
import { ComposerNotFoundError, LoginRequiredError, type PlatformAdapter, type ReadyResult } from './types.js'

export const ADAPTERS: Record<Platform, PlatformAdapter> = { linkedin, instagram, facebook, x }
export type { PlatformAdapter, ReadyResult }
export { ComposerNotFoundError, LoginRequiredError }

export type PrepareJob = { platform: Platform; text: string; mediaPaths: string[] }

/**
 * Fill one composer and stop. Never clicks Post/Share/Tweet — that stays with the user.
 * Every failure resolves to a ReadyResult; nothing here throws at the caller.
 */
export async function preparePlatform(job: PrepareJob): Promise<ReadyResult> {
  const adapter = ADAPTERS[job.platform]
  const label = PLATFORM_LABELS[job.platform]

  let page
  try {
    page = await newPage()
  } catch (err) {
    return {
      platform: job.platform,
      status: 'failed',
      message: err instanceof BrowserUnavailableError ? err.message : 'Could not open the Postbench browser.',
      details: [],
    }
  }

  try {
    await adapter.openComposer(page)
    if (adapter.mediaFirst) {
      await adapter.uploadMedia(page, job.mediaPaths)
      await adapter.setText(page, job.text)
    } else {
      await adapter.setText(page, job.text)
      await adapter.uploadMedia(page, job.mediaPaths)
    }
    return await adapter.checkReady(page)
  } catch (err) {
    // A missing composer is usually a logged-out page that had not finished redirecting.
    if (err instanceof LoginRequiredError || (err instanceof ComposerNotFoundError && (await looksLikeLogin(page))))
      return {
        platform: job.platform,
        status: 'login',
        message: `${label} needs you to log in. Finish it in the Postbench browser window, then prepare again.`,
        details: [],
      }
    if (err instanceof ComposerNotFoundError)
      return {
        platform: job.platform,
        status: 'failed',
        message: `${label}'s page layout may have changed. The page is open — continue manually. (${err.message})`,
        details: [],
      }
    // Playwright timeouts and anything else: report once, never retry in a loop.
    const raw = err instanceof Error ? err.message.split('\n')[0] ?? '' : String(err)
    return {
      platform: job.platform,
      status: 'failed',
      message: `Postbench could not finish setting up ${label}. The page is open — continue manually. (${raw})`,
      details: [],
    }
  }
}

/** Fallback path: just open the platform so the user can paste. */
export async function openComposerOnly(platform: Platform): Promise<{ ok: boolean; message: string }> {
  try {
    const page = await newPage()
    await page.goto(ADAPTERS[platform].composerUrl, { waitUntil: 'domcontentloaded' })
    return { ok: true, message: `${PLATFORM_LABELS[platform]} opened in the Postbench browser.` }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof BrowserUnavailableError ? err.message : 'Could not open the Postbench browser.',
    }
  }
}
