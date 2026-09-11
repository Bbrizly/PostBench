import express, { type Request, type Response, type NextFunction } from 'express'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import {
  DraftSchema,
  BrandSchema,
  PLATFORMS,
  newDraft,
  slugId,
  titleFromText,
  draftStatus,
  validatePlatform,
  composeText,
  platformContentKey,
  type Draft,
  type Platform,
} from '../shared/types.js'
import {
  DraftConflictError,
  ensureDirs,
  listDrafts,
  loadDraft,
  saveDraft,
  deleteDraft,
  loadBrand,
  saveBrand,
  home,
  profileDir,
  REPO_ROOT,
} from './store.js'
import { ACCEPTED_MIME, MAX_FILE_BYTES, convertToMp4, deleteMediaFile, hasFfmpeg, saveUpload } from './media.js'
import { generateContent } from '../ai/index.js'
import { selectAdapter } from '../ai/adapters.js'
import { openComposerOnly, preparePlatform } from '../platforms/index.js'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES } })

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next)

const PlatformEnum = z.enum(PLATFORMS)

async function getDraft(id: string): Promise<Draft> {
  try {
    return await loadDraft(id)
  } catch {
    throw new HttpError(404, `No draft named "${id}".`)
  }
}

export function createApp() {
  const app = express()
  app.use(express.json({ limit: '5mb' }))

  /* ---------- media files ---------- */

  app.get(
    '/media/:draftId/:mediaId',
    asyncRoute(async (req, res) => {
      const draft = await getDraft(String(req.params.draftId))
      const media = draft.media.find((m) => m.id === req.params.mediaId)
      if (!media || !fs.existsSync(media.path)) throw new HttpError(404, 'File not found.')
      res.type(media.mime)
      res.sendFile(path.resolve(media.path))
    }),
  )

  /* ---------- drafts ---------- */

  app.get(
    '/api/drafts',
    asyncRoute(async (_req, res) => {
      const drafts = await listDrafts()
      res.json(
        drafts.map((d) => ({
          id: d.id,
          title: d.title,
          updatedAt: d.updatedAt,
          createdAt: d.createdAt,
          status: draftStatus(d),
          platforms: PLATFORMS.filter((p) => d.platforms[p].enabled),
        })),
      )
    }),
  )

  app.post(
    '/api/drafts',
    asyncRoute(async (req, res) => {
      const body = z.object({ text: z.string().default(''), url: z.string().nullable().default(null) }).parse(req.body)
      const existing = new Set((await listDrafts()).map((d) => d.id))
      let id = slugId(body.text)
      let n = 2
      while (existing.has(id)) id = `${slugId(body.text)}-${n++}`
      res.status(201).json(await saveDraft(newDraft(id, body.text, body.url)))
    }),
  )

  app.get(
    '/api/drafts/:id',
    asyncRoute(async (req, res) => res.json(await getDraft(String(req.params.id)))),
  )

  app.put(
    '/api/drafts/:id',
    asyncRoute(async (req, res) => {
      const incoming = DraftSchema.parse(req.body)
      const current = await getDraft(String(req.params.id))
      if (incoming.id !== current.id) throw new HttpError(400, 'Draft id cannot be changed.')
      if (incoming.revision !== current.revision) throw new DraftConflictError(current.id)
      // Media is owned by the upload endpoints; the UI never gets to rewrite known file paths.
      const merged: Draft = {
        ...incoming,
        media: incoming.media.map((m) => {
          const known = current.media.find((k) => k.id === m.id)
          return known ? { ...known, description: m.description } : m
        }),
        createdAt: current.createdAt,
      }
      merged.title = merged.source.text ? titleFromText(merged.source.text) : merged.title
      merged.status = draftStatus(merged)
      res.json(await saveDraft(merged))
    }),
  )

  app.delete(
    '/api/drafts/:id',
    asyncRoute(async (req, res) => {
      const draft = await getDraft(String(req.params.id))
      for (const m of draft.media) await deleteMediaFile(m)
      await deleteDraft(draft.id)
      res.json({ ok: true })
    }),
  )

  /* ---------- media ---------- */

  app.post(
    '/api/drafts/:id/media',
    upload.array('files', 20),
    asyncRoute(async (req, res) => {
      const draft = await getDraft(String(req.params.id))
      const files = (req.files as Express.Multer.File[] | undefined) ?? []
      if (files.length === 0) throw new HttpError(400, 'No files were uploaded.')

      const errors: string[] = []
      for (const f of files) {
        try {
          draft.media.push(await saveUpload(draft.id, f))
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err))
        }
      }
      res.json({ draft: await saveDraft(draft), errors })
    }),
  )

  app.patch(
    '/api/drafts/:id/media/:mediaId',
    asyncRoute(async (req, res) => {
      const draft = await getDraft(String(req.params.id))
      const body = z.object({ description: z.string().optional(), order: z.number().int().optional() }).parse(req.body)
      const index = draft.media.findIndex((m) => m.id === req.params.mediaId)
      if (index === -1) throw new HttpError(404, 'No such media.')
      const media = draft.media[index]!
      if (body.description !== undefined) media.description = body.description
      if (body.order !== undefined) {
        draft.media.splice(index, 1)
        draft.media.splice(Math.max(0, Math.min(body.order, draft.media.length)), 0, media)
      }
      res.json(await saveDraft(draft))
    }),
  )

  app.post(
    '/api/drafts/:id/media/:mediaId/convert',
    asyncRoute(async (req, res) => {
      const draft = await getDraft(String(req.params.id))
      const index = draft.media.findIndex((m) => m.id === req.params.mediaId)
      if (index === -1) throw new HttpError(404, 'No such media.')
      try {
        draft.media[index] = await convertToMp4(draft.media[index]!)
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err))
      }
      res.json(await saveDraft(draft))
    }),
  )

  app.delete(
    '/api/drafts/:id/media/:mediaId',
    asyncRoute(async (req, res) => {
      const draft = await getDraft(String(req.params.id))
      const media = draft.media.find((m) => m.id === req.params.mediaId)
      if (!media) throw new HttpError(404, 'No such media.')
      await deleteMediaFile(media)
      draft.media = draft.media.filter((m) => m.id !== media.id)
      for (const p of PLATFORMS)
        draft.platforms[p].mediaIds = draft.platforms[p].mediaIds.filter((id) => id !== media.id)
      res.json(await saveDraft(draft))
    }),
  )

  /* ---------- generation ---------- */

  app.post(
    '/api/drafts/:id/generate',
    asyncRoute(async (req, res) => {
      const body = z
        .object({
          platforms: z.array(PlatformEnum).min(1).default([...PLATFORMS]),
          instruction: z.string().optional(),
          useExisting: z.boolean().default(false),
        })
        .parse(req.body)

      const draft = await getDraft(String(req.params.id))
      if (!draft.source.text.trim() && draft.media.length === 0)
        throw new HttpError(400, 'Write an idea or add media before generating.')

      const first = body.platforms[0]!
      const { result, provider, note } = await generateContent({
        idea: draft.source.text,
        url: draft.source.url,
        media: draft.media.map((m) => ({ name: m.name, type: m.type, description: m.description })),
        brand: await loadBrand(),
        platforms: body.platforms,
        instruction: body.instruction,
        existingText: body.useExisting ? composeText(draft.platforms[first]) : undefined,
      })

      for (const p of body.platforms) {
        const generated = result[p]
        if (!generated) continue
        draft.platforms[p] = {
          ...draft.platforms[p],
          text: generated.text,
          hashtags: generated.hashtags,
          suggestedHashtags: generated.suggestedHashtags,
          // Existing preparation/publication records remain as history; contentKey makes them stale.
          mediaIds: draft.platforms[p].mediaIds.length
            ? draft.platforms[p].mediaIds
            : draft.media.filter((m) => m.type === 'image').map((m) => m.id),
        }
      }
      draft.status = draftStatus(draft)
      res.json({ draft: await saveDraft(draft), provider, note })
    }),
  )

  /* ---------- validation ---------- */

  app.get(
    '/api/drafts/:id/validate',
    asyncRoute(async (req, res) => {
      const draft = await getDraft(String(req.params.id))
      res.json(
        Object.fromEntries(PLATFORMS.map((p) => [p, validatePlatform(p, draft.platforms[p], draft.media)])),
      )
    }),
  )

  /* ---------- prepare / publish bookkeeping ---------- */

  app.post(
    '/api/drafts/:id/prepare',
    asyncRoute(async (req, res) => {
      const body = z.object({ platforms: z.array(PlatformEnum).min(1) }).parse(req.body)
      const draft = await getDraft(String(req.params.id))

      const blocked: Record<string, string[]> = {}
      for (const p of body.platforms) {
        const errors = validatePlatform(p, draft.platforms[p], draft.media)
          .filter((i) => i.level === 'error')
          .map((i) => i.message)
        if (errors.length) blocked[p] = errors
      }
      if (Object.keys(blocked).length) return res.status(400).json({ error: 'Fix these first.', blocked })

      const results = []
      for (const p of body.platforms) {
        const post = draft.platforms[p]
        const contentKey = platformContentKey(post)
        const result = await preparePlatform({
          platform: p,
          text: composeText(post),
          mediaPaths: post.mediaIds
            .map((id) => draft.media.find((m) => m.id === id)?.path)
            .filter((x): x is string => Boolean(x)),
        })
        results.push(result)
        draft.platforms[p].prepared = {
          at: new Date().toISOString(),
          status: result.status === 'ready' ? 'ready' : result.status === 'login' ? 'partial' : 'failed',
          message: result.message,
          contentKey,
        }
      }
      draft.status = draftStatus(draft)
      return res.json({ draft: await saveDraft(draft), results })
    }),
  )

  app.post(
    '/api/drafts/:id/open',
    asyncRoute(async (req, res) => {
      const { platform } = z.object({ platform: PlatformEnum }).parse(req.body)
      res.json(await openComposerOnly(platform))
    }),
  )

  app.post(
    '/api/drafts/:id/posted',
    asyncRoute(async (req, res) => {
      const body = z
        .object({ platform: PlatformEnum, url: z.string().nullable().default(null), posted: z.boolean().default(true) })
        .parse(req.body)
      const draft = await getDraft(String(req.params.id))
      const post = draft.platforms[body.platform]
      post.posted = body.posted
        ? { at: new Date().toISOString(), url: body.url, contentKey: platformContentKey(post) }
        : null
      draft.status = draftStatus(draft)
      res.json(await saveDraft(draft))
    }),
  )

  /* ---------- brand & doctor ---------- */

  app.get(
    '/api/brand',
    asyncRoute(async (_req, res) => res.json(await loadBrand())),
  )
  app.put(
    '/api/brand',
    asyncRoute(async (req, res) => res.json(await saveBrand(BrandSchema.parse(req.body)))),
  )

  app.get(
    '/api/doctor',
    asyncRoute(async (_req, res) => {
      let adapter: string | null = null
      let adapterError: string | null = null
      try {
        adapter = selectAdapter()?.label ?? 'none (offline templates)'
      } catch (err) {
        adapterError = err instanceof Error ? err.message : String(err)
      }
      let playwright = false
      try {
        await import('playwright')
        playwright = true
      } catch {
        playwright = false
      }
      res.json({
        node: process.version,
        home: home(),
        browserProfile: profileDir(),
        browserProfileExists: fs.existsSync(profileDir()),
        aiProvider: adapter,
        aiProviderError: adapterError,
        playwrightInstalled: playwright,
        ffmpeg: await hasFfmpeg(),
        acceptedTypes: Object.keys(ACCEPTED_MIME),
      })
    }),
  )

  /* ---------- built UI ---------- */

  const uiDir = path.join(REPO_ROOT, 'dist', 'ui')
  if (fs.existsSync(uiDir)) {
    app.use(express.static(uiDir))
    app.get(/^(?!\/api|\/media).*/, (_req, res) => res.sendFile(path.join(uiDir, 'index.html')))
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
    if (err instanceof DraftConflictError) return res.status(409).json({ error: err.message })
    if (err instanceof z.ZodError)
      return res.status(400).json({ error: `Invalid request: ${err.issues.map((i) => i.message).join('; ')}` })
    const message = err instanceof Error ? err.message : String(err)
    // Readable message to the UI, full detail to the terminal only.
    console.error('[postbench]', err)
    return res.status(500).json({ error: message })
  })

  return app
}

export async function startServer(port = 0): Promise<{ port: number; close: () => Promise<void> }> {
  await ensureDirs()
  const app = createApp()
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'string' || address === null) return reject(new Error('Could not bind a port.'))
      resolve({
        port: address.port,
        close: () => new Promise<void>((done) => server.close(() => done())),
      })
    })
    server.on('error', reject)
  })
}
