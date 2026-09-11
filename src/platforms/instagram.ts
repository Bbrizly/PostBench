import { firstVisible, looksLikeLogin, normalizeComposerText } from './browser.js'
import { ComposerNotFoundError, LoginRequiredError, type PlatformAdapter, type ReadyResult } from './types.js'

const CAPTION = [
  'div[aria-label="Write a caption..."]',
  'textarea[aria-label="Write a caption..."]',
  'div[role="dialog"] div[contenteditable="true"]',
]
const NEXT = ['div[role="dialog"] div[role="button"]:has-text("Next")', 'div[role="dialog"] button:has-text("Next")']
const ATTACHMENTS = 'div[role="dialog"] img[src^="blob:"], div[role="dialog"] video'

export const instagram: PlatformAdapter = {
  id: 'instagram',
  composerUrl: 'https://www.instagram.com/',
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

    // Advance only through observed Next states; stop as soon as the caption screen exists.
    for (let step = 0; step < 3; step++) {
      if (await firstVisible(page, CAPTION, 750)) return
      const next = await firstVisible(page, NEXT, 15_000)
      if (!next) break
      await next.click()
    }

    if (!(await firstVisible(page, CAPTION, 10_000)))
      throw new ComposerNotFoundError('Instagram did not reach the caption step after accepting the media.')
  },

  async setText(page, text) {
    const caption = await firstVisible(page, CAPTION, 15_000)
    if (!caption) throw new ComposerNotFoundError('Could not reach the Instagram caption field.')
    const isTextarea = await caption.evaluate((el) => el.tagName === 'TEXTAREA').catch(() => false)
    if (isTextarea) await caption.fill(text)
    else {
      await caption.click()
      await page.keyboard.insertText(text)
    }
  },

  async checkReady(page, expected): Promise<ReadyResult> {
    const details: string[] = []
    const caption = await firstVisible(page, CAPTION, 5000)
    let observed = ''
    if (caption) {
      observed = await caption.inputValue().catch(async () => caption.innerText().catch(() => ''))
    }
    const textMatches = normalizeComposerText(observed) === normalizeComposerText(expected.text)
    details.push(textMatches ? 'Exact caption verified' : 'Caption does not match the reviewed draft')

    const attachments = await page.locator(ATTACHMENTS).count().catch(() => 0)
    const mediaDetected = expected.mediaCount === 0 || attachments > 0
    if (expected.mediaCount > 0)
      details.push(mediaDetected ? `${expected.mediaCount} file(s) submitted; media preview detected` : 'Media preview was not detected')

    const share = await firstVisible(page, ['div[role="dialog"] div[role="button"]:has-text("Share")'], 4000)
    const enabled = share ? (await share.getAttribute('aria-disabled').catch(() => 'true')) !== 'true' : false
    if (enabled) details.push('Share button enabled — publish manually')

    const ready = textMatches && mediaDetected && enabled
    return {
      platform: 'instagram',
      status: ready ? 'ready' : 'partial',
      message: ready ? 'Reviewed caption and media reached the final composer. Review and click Share.' : 'Instagram composer opened, but Postbench could not verify the reviewed payload.',
      details,
    }
  },
}
