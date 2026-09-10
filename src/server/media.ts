import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mediaDir, safeId } from './store.js'
import type { Media } from '../shared/types.js'

const run = promisify(execFile)

export const ACCEPTED_MIME: Record<string, { ext: string; type: 'image' | 'video' }> = {
  'image/png': { ext: 'png', type: 'image' },
  'image/jpeg': { ext: 'jpg', type: 'image' },
  'image/webp': { ext: 'webp', type: 'image' },
  'image/gif': { ext: 'gif', type: 'image' },
  'video/mp4': { ext: 'mp4', type: 'video' },
  'video/quicktime': { ext: 'mov', type: 'video' },
}

export const MAX_FILE_BYTES = 512 * 1024 * 1024

export async function hasFfmpeg(): Promise<boolean> {
  return run('ffmpeg', ['-version'])
    .then(() => true)
    .catch(() => false)
}

async function probeDuration(file: string): Promise<number | null> {
  try {
    const { stdout } = await run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      file,
    ])
    const n = Number(stdout.trim())
    return Number.isFinite(n) ? Math.round(n) : null
  } catch {
    return null
  }
}

export async function saveUpload(
  draftId: string,
  file: { originalname: string; mimetype: string; buffer: Buffer },
): Promise<Media> {
  const spec = ACCEPTED_MIME[file.mimetype]
  if (!spec) throw new Error(`${file.originalname}: ${file.mimetype} is not a supported file type.`)

  const dir = path.join(mediaDir(), safeId(draftId))
  await fs.mkdir(dir, { recursive: true })
  const id = `media-${randomUUID().slice(0, 8)}`
  const dest = path.join(dir, `${id}.${spec.ext}`)
  await fs.writeFile(dest, file.buffer)

  return {
    id,
    path: dest,
    name: path.basename(file.originalname) || `${id}.${spec.ext}`,
    type: spec.type,
    mime: file.mimetype,
    size: file.buffer.byteLength,
    description: '',
    durationSec: spec.type === 'video' ? await probeDuration(dest) : null,
  }
}

/** MOV -> MP4 so Instagram and X will take it. No editing, just a container/codec swap. */
export async function convertToMp4(media: Media): Promise<Media> {
  if (media.mime !== 'video/quicktime') throw new Error('Only .mov files need converting.')
  if (!(await hasFfmpeg()))
    throw new Error('FFmpeg is not installed, so Postbench cannot convert this file. Install it with: brew install ffmpeg')

  const dest = media.path.replace(/\.mov$/i, '.mp4')
  await run('ffmpeg', ['-y', '-i', media.path, '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', dest], {
    maxBuffer: 32 * 1024 * 1024,
  })
  const stat = await fs.stat(dest)
  return {
    ...media,
    path: dest,
    name: media.name.replace(/\.mov$/i, '.mp4'),
    mime: 'video/mp4',
    size: stat.size,
  }
}

export async function deleteMediaFile(media: Media): Promise<void> {
  // Only ever remove files we put inside the media directory.
  if (!path.resolve(media.path).startsWith(path.resolve(mediaDir()))) return
  await fs.rm(media.path, { force: true })
}

/** URL the UI uses to preview a file. */
export function mediaUrl(draftId: string, media: Media): string {
  return `/media/${encodeURIComponent(safeId(draftId))}/${encodeURIComponent(path.basename(media.path))}`
}
