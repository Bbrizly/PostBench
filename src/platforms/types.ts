import type { Page } from 'playwright'
import type { Platform } from '../shared/types.js'

export type ReadyStatus = 'ready' | 'partial' | 'login' | 'failed'

export type ReadyResult = {
  platform: Platform
  status: ReadyStatus
  message: string
  details: string[]
}

export type ExpectedComposerState = {
  text: string
  mediaCount: number
}

export interface PlatformAdapter {
  id: Platform
  /** Where the user ends up if automation is skipped entirely. */
  composerUrl: string
  /** Instagram only builds its caption field after media is accepted. */
  mediaFirst?: boolean
  openComposer(page: Page): Promise<void>
  setText(page: Page, text: string): Promise<void>
  uploadMedia(page: Page, paths: string[]): Promise<void>
  checkReady(page: Page, expected: ExpectedComposerState): Promise<ReadyResult>
}

export class ComposerNotFoundError extends Error {}
export class LoginRequiredError extends Error {}
