import { firstVisible, looksLikeLogin } from './browser.js'
import { ComposerNotFoundError, LoginRequiredError, type PlatformAdapter, type ReadyResult } from './types.js'

const DIALOG_EDITOR = [
  'div[role="dialog"] div[contenteditable="true"][role="textbox"]',
  'div[role="dialog"] div[contenteditable="true"]',
]

export const facebook: PlatformAdapter = {
  id: 'facebook',
  composerUrl: 'https://www.facebook.com/',

  async openComposer(page) {
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' })
    if (await looksLikeLogin(page)) throw new LoginRequiredError('Log into Facebook in this window.')

    const trigger = await firstVisible(page, [
      'div[role="button"]:has-text("What\'s on your mind")',
      'span:has-text("What\'s on your mind")',
      'div[role="button"][aria-label*="mind" i]',
    ])
    if (!trigger) throw new ComposerNotFoundError('Could not find the "What\'s on your mind?" box.')
    await trigger.click()

    const editor = await firstVisible(page, DIALOG_EDITOR)
    if (!editor) throw new ComposerNotFoundError('The Facebook post dialog did not open.')
  },

  async setText(page, text) {
    const editor = await firstVisible(page, DIALOG_EDITOR)
    if (!editor) throw new ComposerNotFoundError('The Facebook post dialog is not available.')
    await editor.click()
    await page.keyboard.insertText(text)
  },

  async uploadMedia(page, paths) {
    if (paths.length === 0) return
    const photoButton = await firstVisible(
      page,
      [
        'div[role="dialog"] div[aria-label="Photo/video"]',
        'div[role="dialog"] div[role="button"]:has-text("Photo/video")',
      ],
      8000,
    )
    await photoButton?.click().catch(() => {})
    const input = page.locator('div[role="dialog"] input[type="file"], input[type="file"]').first()
    if ((await input.count()) === 0) throw new ComposerNotFoundError("Could not find Facebook's media input.")
    await input.setInputFiles(paths)
    await page.waitForTimeout(3000)
  },

  async checkReady(page): Promise<ReadyResult> {
    const details: string[] = []
    const editor = await firstVisible(page, DIALOG_EDITOR, 5000)
    const text = (await editor?.innerText().catch(() => '')) ?? ''
    if (text.trim()) details.push('Text inserted')
    const attachments = await page
      .locator('div[role="dialog"] img[alt*="photo" i], div[role="dialog"] video')
      .count()
      .catch(() => 0)
    if (attachments > 0) details.push(`${attachments} attachment(s) visible`)
    const postButton = await firstVisible(page, ['div[role="dialog"] div[aria-label="Post"]'], 4000)
    if (postButton) details.push('Post button available — publish manually')
    return {
      platform: 'facebook',
      status: text.trim() ? 'ready' : 'partial',
      message: text.trim() ? 'Composer filled. Review and click Post.' : 'Composer open but text was not detected.',
      details,
    }
  },
}
