import { firstVisible, looksLikeLogin } from './browser.js'
import { ComposerNotFoundError, LoginRequiredError, type PlatformAdapter, type ReadyResult } from './types.js'

const EDITOR = ['div.ql-editor[contenteditable="true"]', 'div[role="textbox"][contenteditable="true"]']

export const linkedin: PlatformAdapter = {
  id: 'linkedin',
  composerUrl: 'https://www.linkedin.com/feed/',

  async openComposer(page) {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' })
    if (await looksLikeLogin(page)) throw new LoginRequiredError('Log into LinkedIn in this window.')

    const start = await firstVisible(page, [
      'button:has-text("Start a post")',
      'button.share-box-feed-entry__trigger',
      '[aria-label="Create a post"]',
    ])
    if (!start) throw new ComposerNotFoundError('Could not find the "Start a post" button.')
    await start.click()

    const editor = await firstVisible(page, EDITOR)
    if (!editor) throw new ComposerNotFoundError('The post editor did not open.')
  },

  async setText(page, text) {
    const editor = await firstVisible(page, EDITOR)
    if (!editor) throw new ComposerNotFoundError('The post editor is not available.')
    await editor.click()
    // insertText rather than fill: LinkedIn's rich-text editor ignores value writes.
    await page.keyboard.insertText(text)
  },

  async uploadMedia(page, paths) {
    if (paths.length === 0) return
    const button = await firstVisible(page, [
      'button[aria-label*="Add media" i]',
      'button[aria-label*="Add a photo" i]',
      'button:has-text("Add media")',
    ])
    if (button) {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 10_000 }).catch(() => null),
        button.click(),
      ])
      if (chooser) {
        await chooser.setFiles(paths)
        await page.waitForTimeout(2500)
        const next = await firstVisible(page, ['button:has-text("Next")', 'button:has-text("Done")'], 6000)
        await next?.click().catch(() => {})
        return
      }
    }
    const input = page.locator('input[type="file"]').first()
    if ((await input.count()) === 0) throw new ComposerNotFoundError("Could not find LinkedIn's media picker.")
    await input.setInputFiles(paths)
    await page.waitForTimeout(2500)
  },

  async checkReady(page): Promise<ReadyResult> {
    const details: string[] = []
    const editor = await firstVisible(page, EDITOR, 5000)
    const text = (await editor?.innerText().catch(() => '')) ?? ''
    if (text.trim()) details.push('Text inserted')
    const attachments = await page
      .locator('.share-creation-state__preview img, [data-test-id="media-preview"] img, .image-selector__thumbnail')
      .count()
      .catch(() => 0)
    if (attachments > 0) details.push(`${attachments} attachment(s) visible`)
    const postButton = await firstVisible(
      page,
      ['button.share-actions__primary-action', 'button:has-text("Post")'],
      4000,
    )
    if (postButton) details.push('Post button available — publish manually')
    return {
      platform: 'linkedin',
      status: text.trim() ? 'ready' : 'partial',
      message: text.trim() ? 'Composer filled. Review and click Post.' : 'Composer open but text was not detected.',
      details,
    }
  },
}
