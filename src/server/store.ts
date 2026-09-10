import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { DraftSchema, BrandSchema, type Draft, type Brand } from '../shared/types.js'

const here = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(here, '../..')

export function home(): string {
  return process.env.POSTBENCH_HOME || path.join(os.homedir(), '.postbench')
}
export const draftsDir = () => path.join(home(), 'drafts')
export const mediaDir = () => path.join(home(), 'media')
export const profileDir = () => path.join(home(), 'browser-profile')

export async function ensureDirs(): Promise<void> {
  await fs.mkdir(draftsDir(), { recursive: true })
  await fs.mkdir(mediaDir(), { recursive: true })
}

const draftPath = (id: string) => path.join(draftsDir(), `${safeId(id)}.json`)

/** Draft ids become filenames — never let them escape the drafts dir. */
export function safeId(id: string): string {
  const clean = path.basename(id).replace(/[^a-zA-Z0-9._-]/g, '-')
  if (!clean || clean === '.' || clean === '..') throw new Error(`Invalid draft id: ${id}`)
  return clean
}

export async function saveDraft(draft: Draft): Promise<Draft> {
  await ensureDirs()
  const parsed = DraftSchema.parse({ ...draft, updatedAt: new Date().toISOString() })
  const file = draftPath(parsed.id)
  await fs.writeFile(`${file}.tmp`, JSON.stringify(parsed, null, 2))
  await fs.rename(`${file}.tmp`, file)
  return parsed
}

export async function loadDraft(id: string): Promise<Draft> {
  const raw = await fs.readFile(draftPath(id), 'utf8')
  return DraftSchema.parse(JSON.parse(raw))
}

export async function listDrafts(): Promise<Draft[]> {
  await ensureDirs()
  const files = (await fs.readdir(draftsDir())).filter((f) => f.endsWith('.json'))
  const drafts: Draft[] = []
  for (const f of files) {
    try {
      drafts.push(DraftSchema.parse(JSON.parse(await fs.readFile(path.join(draftsDir(), f), 'utf8'))))
    } catch {
      // skip unreadable/legacy drafts rather than crashing the list
    }
  }
  return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function deleteDraft(id: string): Promise<void> {
  await fs.rm(draftPath(id), { force: true })
}

const DEFAULT_BRAND: Brand = BrandSchema.parse({
  name: 'My Project',
  website: null,
  audience: [],
  voice: ['plainspoken', 'direct', 'practical'],
  avoid: ['AI hype', 'corporate SaaS language', 'revolutionary', 'game-changing'],
  preferred_phrases: [],
})

/** User config wins; repo config/brand.json is the fallback example. */
export async function loadBrand(): Promise<Brand> {
  for (const p of [path.join(home(), 'brand.json'), path.join(REPO_ROOT, 'config', 'brand.json')]) {
    try {
      return BrandSchema.parse(JSON.parse(await fs.readFile(p, 'utf8')))
    } catch {
      continue
    }
  }
  return DEFAULT_BRAND
}

export async function saveBrand(brand: Brand): Promise<Brand> {
  await fs.mkdir(home(), { recursive: true })
  const parsed = BrandSchema.parse(brand)
  await fs.writeFile(path.join(home(), 'brand.json'), JSON.stringify(parsed, null, 2))
  return parsed
}
