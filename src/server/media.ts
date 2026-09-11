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
export const stagingDir = () => path.join(mediaDir(), '.staging')

export async function hasFfmpeg(): Promise<boolean> {
  return run('ffmpeg', ['-version'], { timeout: 10_000 })
    .then(() => true)
    .catch(() => false)
}

async function probeDuration(file: string): Promise<number | null> {
  try {
    const { stdout } = await run(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
      { timeout: 30_000 },
    )
    const n = Number(stdout.trim())
    return Number.isFinite(n) ? Math.round(n) : null
  } catch {
    return null
  }
}

async function sniffMime(file: string): Promise<string | null> {
  const handle = await fs.open(file, 'r')
  try {
    const header = Buffer.alloc(16)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    const b = header.subarray(0, bytesRead)
    if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      return 'image/png'
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
    const ascii = b.toString('ascii')
    if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'image/gif'
    if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp'
    if (b.length >= 12 && ascii.slice(4, 8) === 'ftyp')
      return ascii.slice(8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4'
    return null
  } finally {
    await handle.close()
  }
}

export async function saveUpload(
  draftId: string,
  file: { originalname: string; mimetype: string; path: string; size: number },
): Promise<Media> {
  let moved = false
  try {
    const detectedMime = await sniffMime(file.path)
    const spec = detectedMime ? ACCEPTED_MIME[detectedMime] : undefined
    if (!spec)
      throw new Error(`${file.originalname}: the file contents are not a supported PNG, JPEG, WEBP, GIF, MP4, or MOV file.`)

    const dir = path.join(mediaDir(), safeId(draftId))
    await fs.mkdir(dir, { recursive: true })
    const id = `media-${randomUUID().slice(0, 8)}`
    const dest = path.join(dir, `${id}.${spec.ext}`)
    await fs.rename(file.path, dest)
    moved = true
    const stat = await fs.stat(dest)

    return {
      id,
      path: dest,
      name: path.basename(file.originalname) || `${id}.${spec.ext}`,
      type: spec.type,
      mime: detectedMime,
      size: stat.size,
      description: '',
      durationSec: spec.type === 'video' ? await probeDuration(dest) : null,
    }
  } finally {
    if (!moved) await fs.rm(file.path, { force: true }).catch(() => undefined)
  }
}

/** MOV -> broadly compatible H.264/AAC MP4. This is a real transcode, not a lossless container swap. */
export async function convertToMp4(media: Media): Promise<Media> {
  if (media.mime !== 'video/quicktime') throw new Error('Only .mov files need converting.')
  if (!(await hasFfmpeg()))
    throw new Error('FFmpeg is not installed, so Postbench cannot convert this file. Install it with: brew install ffmpeg')

  const dest = media.path.replace(/\.mov$/i, '.mp4')
  await run(
    'ffmpeg',
    [
      '-y',
      '-i',
      media.path,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      dest,
    ],
    { maxBuffer: 32 * 1024 * 1024, timeout: 15 * 60_000 },
  )
  const stat = await fs.stat(dest)
  return {
    ...media,
    path: dest,
    name: media.name.replace(/\.mov$/i, '.mp4'),
    mime: 'video/mp4',
    size: stat.size,
    durationSec: await probeDuration(dest),
  }
}

function isInside(parent: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(candidate))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export async function deleteMediaFile(media: Pick<Media, 'path'>): Promise<void> {
  if (!isInside(mediaDir(), media.path)) return
  await fs.rm(media.path, { force: true })
}

/** URL the UI uses to preview a file. */
export function mediaUrl(draftId: string, media: Media): string {
  return `/media/${encodeURIComponent(safeId(draftId))}/${encodeURIComponent(path.basename(media.path))}`
}
