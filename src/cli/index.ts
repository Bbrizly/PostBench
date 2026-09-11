#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import open from 'open'
import { startServer } from '../server/app.js'
import {
  ensureDirs,
  listDrafts,
  loadDraft,
  saveDraft,
  loadBrand,
  home,
  profileDir,
  draftsDir,
  REPO_ROOT,
} from '../server/store.js'
import {
  newDraft,
  slugId,
  PLATFORMS,
  composeText,
  draftStatus,
  defaultMediaSelection,
} from '../shared/types.js'
import { generateContent } from '../ai/index.js'
import { selectAdapter } from '../ai/adapters.js'
import { hasFfmpeg } from '../server/media.js'

const args = process.argv.slice(2)
const command = args[0] ?? 'help'

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return undefined
  const next = args[i + 1]
  return next && !next.startsWith('--') ? next : ''
}
const hasFlag = (name: string) => args.includes(`--${name}`)

async function uniqueId(text: string): Promise<string> {
  const existing = new Set((await listDrafts()).map((d) => d.id))
  const base = slugId(text)
  let id = base
  let n = 2
  while (existing.has(id)) id = `${base}-${n++}`
  return id
}

async function serve(draftId: string | null, shouldOpen: boolean): Promise<void> {
  const { port } = await startServer(Number(process.env.PORT || 0))
  const uiBuilt = fs.existsSync(path.join(REPO_ROOT, 'dist', 'ui', 'index.html'))
  const url = `http://127.0.0.1:${port}/${draftId ? `#/d/${encodeURIComponent(draftId)}` : ''}`

  if (!uiBuilt) {
    console.log('The UI has not been built yet. Run:  npm run build')
    console.log(`(API is running on http://127.0.0.1:${port} — for UI development run "npm run dev".)`)
    return
  }
  console.log(`Postbench → ${url}`)
  console.log('Press Ctrl+C to stop.')
  if (shouldOpen) await open(url)
}

async function main() {
  await ensureDirs()

  switch (command) {
    case 'create': {
      const text = flag('input') ?? ''
      const draft = newDraft(await uniqueId(text), text, flag('url') || null)
      const saved = await saveDraft(draft)
      console.log(`Created draft ${saved.id}`)
      await serve(saved.id, !hasFlag('no-open'))
      break
    }

    case 'open': {
      const id = args[1]
      if (!id) return fail('Usage: postbench open <draft-id>')
      await loadDraft(id).catch(() => fail(`No draft named "${id}".`))
      await serve(id, true)
      break
    }

    case 'ui':
    case 'serve': {
      await serve(null, !hasFlag('no-open'))
      break
    }

    case 'list': {
      const drafts = await listDrafts()
      if (drafts.length === 0) return console.log('No drafts yet. Run: postbench create')
      for (const d of drafts)
        console.log(
          `${d.id.padEnd(40)} ${draftStatus(d).padEnd(9)} ${new Date(d.updatedAt).toISOString().slice(0, 10)}  ${d.title}`,
        )
      break
    }

    case 'generate': {
      const id = args[1]
      if (!id) return fail('Usage: postbench generate <draft-id>')
      const draft = await loadDraft(id).catch(() => fail(`No draft named "${id}".`))
      const { result, provider, note } = await generateContent({
        idea: draft.source.text,
        url: draft.source.url,
        media: draft.media.map((m) => ({ name: m.name, type: m.type, description: m.description })),
        brand: await loadBrand(),
        platforms: [...PLATFORMS],
      })
      for (const p of PLATFORMS) {
        const g = result[p]
        if (!g) continue
        draft.platforms[p] = {
          ...draft.platforms[p],
          text: g.text,
          hashtags: g.hashtags,
          suggestedHashtags: g.suggestedHashtags,
          mediaIds: draft.platforms[p].mediaIds.length
            ? draft.platforms[p].mediaIds
            : defaultMediaSelection(p, draft.media),
        }
      }
      draft.status = draftStatus(draft)
      const saved = await saveDraft(draft)
      console.log(`Generated with ${provider}.${note ? ` ${note}` : ''}\n`)
      for (const p of PLATFORMS) console.log(`--- ${p} ---\n${composeText(saved.platforms[p])}\n`)
      break
    }

    case 'doctor': {
      const rows: [string, string][] = []
      rows.push(['Node', process.version])
      rows.push(['Data directory', `${home()}${fs.existsSync(home()) ? '' : ' (will be created)'}`])
      rows.push(['Drafts', `${draftsDir()} · ${(await listDrafts()).length} draft(s)`])
      try {
        const a = selectAdapter()
        rows.push(['AI provider', a ? a.label : 'none — offline templates only'])
      } catch (err) {
        rows.push(['AI provider', `misconfigured: ${(err as Error).message}`])
      }
      let playwright = 'not installed — run: npx playwright install chromium'
      try {
        const { chromium } = await import('playwright')
        playwright = fs.existsSync(chromium.executablePath())
          ? `ok (${chromium.executablePath()})`
          : 'package installed, browser missing — run: npx playwright install chromium'
      } catch {
        /* leave the install hint */
      }
      rows.push(['Playwright', playwright])
      rows.push(['Browser profile', `${profileDir()}${fs.existsSync(profileDir()) ? '' : ' (created on first prepare)'}`])
      rows.push(['FFmpeg', (await hasFfmpeg()) ? 'ok' : 'not installed — MOV conversion unavailable'])
      rows.push(['Brand', (await loadBrand()).name])
      rows.push(['UI build', fs.existsSync(path.join(REPO_ROOT, 'dist/ui/index.html')) ? 'ok' : 'missing — run: npm run build'])

      const pad = Math.max(...rows.map(([k]) => k.length))
      for (const [k, v] of rows) console.log(`${k.padEnd(pad)}  ${v}`)
      break
    }

    default:
      console.log(`postbench — local social posting cockpit

  postbench create [--input "..."] [--url "..."] [--no-open] new draft, opens the UI by default
  postbench open <draft-id>                                 open an existing draft
  postbench serve [--no-open]                               just start the UI
  postbench list                                            list drafts
  postbench generate <draft-id>                             generate posts without the UI
  postbench doctor                                          check the setup
`)
  }
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
