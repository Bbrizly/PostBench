import { firstVisible, looksLikeLogin, normalizeComposerText, waitForCount } from './browser.js'
import { ComposerNotFoundError, LoginRequiredError, type PlatformAdapter, type ReadyResult } from './types.js'

const DIALOG_EDITOR = [
  'div[role="dialog"] div[contenteditable="true"][role="textbox"]',
  'div[role="dialog"] div[contenteditable="true"]',
]
const ATTACHMENTS = 'div[role="dialog"] img[alt*="photo" i], div[role="dialog"] [data-visualcompletion="media-vc-image"], div[role="dialog"] video'

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
    if (!(await waitForCount(page, ATTACHMENTS, paths.length, 60_000)))
      throw new ComposerNotFoundError('Facebook did not confirm every selected attachment.')
  },

  async checkReady(page, expected): Promise<ReadyResult> {
    const details: string[] = []
    const editor = await firstVisible(page, DIALOG_EDITOR, 5000)
    const actualText = normalizeComposerText((await editor?.innerText().catch(() => '')) ?? '')
    const expectedText = normalizeComposerText(expected.text)
    const textMatches = actualText === expectedText
    details.push(textMatches ? 'Exact text verified' : 'Text does not match the reviewed draft')

    const attachments = await page.locator(ATTACHMENTS).count().catch(() => 0)
    const mediaMatches = expected.mediaCount === 0 || attachments >= expected.mediaCount
    if (expected.mediaCount > 0)
      details.push(mediaMatches ? `${expected.mediaCount} attachment(s) verified` : `${attachments}/${expected.mediaCount} attachment(s) detected`)

    const postButton = await firstVisible(
      page,
      ['div[role="dialog"] div[aria-label="Post"]', 'div[role="dialog"] [role="button"]:has-text("Post")'],
      4000,
    )
    const enabled = postButton ? (await postButton.getAttribute('aria-disabled').catch(() => 'true')) !== 'true' : false
    if (enabled) details.push('Post button enabled — publish manually')

    const ready = textMatches && mediaMatches && enabled
    return {
      platform: 'facebook',
      status: ready ? 'ready' : 'partial',
      message: ready ? 'Exact reviewed payload is in the composer. Review and click Post.' : 'Composer opened, but Postbench could not verify the exact reviewed payload.',
      details,
    }
  },
}
