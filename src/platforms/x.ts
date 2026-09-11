import { firstVisible, looksLikeLogin, normalizeComposerText, waitForCount } from './browser.js'
import { ComposerNotFoundError, LoginRequiredError, type PlatformAdapter, type ReadyResult } from './types.js'

const EDITOR = ['div[data-testid="tweetTextarea_0"]', 'div[role="textbox"][contenteditable="true"]']
const ATTACHMENTS = '[data-testid="attachments"] img, [data-testid="attachments"] video'

export const x: PlatformAdapter = {
  id: 'x',
  composerUrl: 'https://x.com/compose/post',

  async openComposer(page) {
    await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded' })
    if (await looksLikeLogin(page)) throw new LoginRequiredError('Log into X in this window.')
    const editor = await firstVisible(page, EDITOR)
    if (!editor) throw new ComposerNotFoundError('Could not find the X composer.')
  },

  async setText(page, text) {
    const editor = await firstVisible(page, EDITOR)
    if (!editor) throw new ComposerNotFoundError('The X composer is not available.')
    await editor.click()
    await page.keyboard.insertText(text)
  },

  async uploadMedia(page, paths) {
    if (paths.length === 0) return
    const input = page.locator('input[data-testid="fileInput"], input[type="file"]').first()
    if ((await input.count()) === 0) throw new ComposerNotFoundError("Could not find X's media input.")
    await input.setInputFiles(paths)
    if (!(await waitForCount(page, ATTACHMENTS, paths.length, 60_000)))
      throw new ComposerNotFoundError('X did not confirm every selected attachment.')
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

    const postButton = await firstVisible(page, ['[data-testid="tweetButton"]', 'button:has-text("Post")'], 4000)
    const enabled = postButton ? !(await postButton.isDisabled().catch(() => true)) : false
    if (enabled) details.push('Post button enabled — publish manually')

    const ready = textMatches && mediaMatches && enabled
    return {
      platform: 'x',
      status: ready ? 'ready' : 'partial',
      message: ready ? 'Exact reviewed payload is in the composer. Review and click Post.' : 'Composer opened, but Postbench could not verify the exact reviewed payload.',
      details,
    }
  },
}
