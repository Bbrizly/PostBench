import { firstVisible, looksLikeLogin, normalizeComposerText, waitForCount } from './browser.js'
import { ComposerNotFoundError, LoginRequiredError, type PlatformAdapter, type ReadyResult } from './types.js'

const EDITOR = ['div.ql-editor[contenteditable="true"]', 'div[role="textbox"][contenteditable="true"]']
const ATTACHMENTS = '.share-creation-state__preview img, .share-creation-state__preview video, [data-test-id="media-preview"] img, [data-test-id="media-preview"] video, .image-selector__thumbnail'

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
        const next = await firstVisible(page, ['button:has-text("Next")', 'button:has-text("Done")'], 30_000)
        await next?.click().catch(() => {})
        if (!(await waitForCount(page, ATTACHMENTS, paths.length, 60_000)))
          throw new ComposerNotFoundError('LinkedIn did not confirm every selected attachment.')
        return
      }
    }
    const input = page.locator('input[type="file"]').first()
    if ((await input.count()) === 0) throw new ComposerNotFoundError("Could not find LinkedIn's media picker.")
    await input.setInputFiles(paths)
    if (!(await waitForCount(page, ATTACHMENTS, paths.length, 60_000)))
      throw new ComposerNotFoundError('LinkedIn did not confirm every selected attachment.')
  },

  async checkReady(page, expected): Promise<ReadyResult> {
    const details: string[] = []
    const editor = await firstVisible(page, EDITOR, 5000)
    const actualText = normalizeComposerText((await editor?.innerText().catch(() => '')) ?? '')
    const expectedText = normalizeComposerText(expected.text)
    const textMatches = actualText === expectedText
    details.push(textMatches ? 'Exact text verified' : 'Text does not match the reviewed draft')

    const attachments = await page.locator(ATTACHMENTS).count().catch(() => 0)
    const mediaMatches = expected.mediaCount === 0 || attachments >= expected.mediaCount
    if (expected.mediaCount > 0)
      details.push(mediaMatches ? `${expected.mediaCount} attachment(s) verified` : `${attachments}/${expected.mediaCount} attachment(s) detected`)

    const postButton = await firstVisible(page, ['button.share-actions__primary-action', 'button:has-text("Post")'], 4000)
    const enabled = postButton ? !(await postButton.isDisabled().catch(() => true)) : false
    if (enabled) details.push('Post button enabled — publish manually')

    const ready = textMatches && mediaMatches && enabled
    return {
      platform: 'linkedin',
      status: ready ? 'ready' : 'partial',
      message: ready ? 'Exact reviewed payload is in the composer. Review and click Post.' : 'Composer opened, but Postbench could not verify the exact reviewed payload.',
      details,
    }
  },
}
