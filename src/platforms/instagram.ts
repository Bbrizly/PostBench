import { firstVisible, looksLikeLogin } from './browser.js'
import { ComposerNotFoundError, LoginRequiredError, type PlatformAdapter, type ReadyResult } from './types.js'

const CAPTION = [
  'div[aria-label="Write a caption..."]',
  'textarea[aria-label="Write a caption..."]',
  'div[role="dialog"] div[contenteditable="true"]',
]

export const instagram: PlatformAdapter = {
  id: 'instagram',
  composerUrl: 'https://www.instagram.com/',
  // Instagram builds the caption step only after media is accepted.
  mediaFirst: true,

  async openComposer(page) {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' })
    if (await looksLikeLogin(page)) throw new LoginRequiredError('Log into Instagram in this window.')

    const create = await firstVisible(page, [
      'a[href="#"]:has(svg[aria-label="New post"])',
      'div[role="button"]:has(svg[aria-label="New post"])',
      'svg[aria-label="New post"]',
      'a:has-text("Create")',
    ])
    if (!create) throw new ComposerNotFoundError('Could not find Instagram\'s "Create" button.')
    await create.click()

    // A "Post" submenu appears for some accounts.
    const postOption = await firstVisible(page, ['div[role="menu"] span:has-text("Post")'], 3000)
    await postOption?.click().catch(() => {})

    const dialog = await firstVisible(page, ['div[role="dialog"]'])
    if (!dialog) throw new ComposerNotFoundError('The Instagram create dialog did not open.')
  },

  async uploadMedia(page, paths) {
    if (paths.length === 0)
      throw new ComposerNotFoundError('Instagram needs at least one image or video before a caption can be written.')

    const input = page.locator('div[role="dialog"] input[type="file"]').first()
    if ((await input.count()) > 0) {
      await input.setInputFiles(paths)
    } else {
      const select = await firstVisible(page, ['button:has-text("Select from computer")'])
      if (!select) throw new ComposerNotFoundError('Could not find "Select from computer".')
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 10_000 }).catch(() => null),
        select.click(),
      ])
      if (!chooser) throw new ComposerNotFoundError('Instagram did not open a file picker.')
      await chooser.setFiles(paths)
    }
    await page.waitForTimeout(3000)

    // Crop step, then filter/edit step. Both are labelled "Next".
    for (let step = 0; step < 2; step++) {
      const next = await firstVisible(page, ['div[role="dialog"] div[role="button"]:has-text("Next")'], 12_000)
      if (!next) break
      await next.click()
      await page.waitForTimeout(1500)
    }
  },

  async setText(page, text) {
    const caption = await firstVisible(page, CAPTION, 15_000)
    if (!caption) throw new ComposerNotFoundError('Could not reach the Instagram caption field.')
    await caption.click()
    await page.keyboard.insertText(text)
  },

  async checkReady(page): Promise<ReadyResult> {
    const details: string[] = []
    const caption = await firstVisible(page, CAPTION, 5000)
    const text = (await caption?.innerText().catch(() => '')) ?? ''
    if (text.trim()) details.push('Caption inserted')
    const attachments = await page
      .locator('div[role="dialog"] img[src^="blob:"], div[role="dialog"] video')
      .count()
      .catch(() => 0)
    if (attachments > 0) details.push(`${attachments} attachment(s) visible`)
    const share = await firstVisible(page, ['div[role="dialog"] div[role="button"]:has-text("Share")'], 4000)
    if (share) details.push('Share button available — publish manually')
    return {
      platform: 'instagram',
      status: text.trim() && share ? 'ready' : 'partial',
      message:
        text.trim() && share
          ? 'Composer filled. Review and click Share.'
          : 'Instagram composer reached, but not everything was confirmed. Finish it by hand.',
      details,
    }
  },
}
