import { firstVisible, looksLikeLogin } from './browser.js'
import { ComposerNotFoundError, LoginRequiredError, type PlatformAdapter, type ReadyResult } from './types.js'

const EDITOR = ['div[data-testid="tweetTextarea_0"]', 'div[role="textbox"][contenteditable="true"]']

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
    await page.waitForTimeout(2500)
  },

  async checkReady(page): Promise<ReadyResult> {
    const details: string[] = []
    const editor = await firstVisible(page, EDITOR, 5000)
    const text = (await editor?.innerText().catch(() => '')) ?? ''
    if (text.trim()) details.push('Text inserted')
    const attachments = await page
      .locator('[data-testid="attachments"] img, [data-testid="attachments"] video')
      .count()
      .catch(() => 0)
    if (attachments > 0) details.push(`${attachments} attachment(s) visible`)
    const postButton = await firstVisible(page, ['[data-testid="tweetButton"]', 'button:has-text("Post")'], 4000)
    const enabled = postButton ? !(await postButton.isDisabled().catch(() => true)) : false
    if (enabled) details.push('Post button enabled — publish manually')
    return {
      platform: 'x',
      status: text.trim() ? 'ready' : 'partial',
      message: text.trim() ? 'Composer filled. Review and click Post.' : 'Composer open but text was not detected.',
      details,
    }
  },
}
