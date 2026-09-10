import type { Brand, Draft, Platform, ValidationIssue } from '../shared/types.js'

export type DraftSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  status: Draft['status']
  platforms: Platform[]
}

export type PrepareResult = {
  platform: Platform
  status: 'ready' | 'partial' | 'login' | 'failed'
  message: string
  details: string[]
}

export type Doctor = {
  node: string
  home: string
  browserProfile: string
  browserProfileExists: boolean
  aiProvider: string | null
  aiProviderError: string | null
  playwrightInstalled: boolean
  ffmpeg: boolean
  acceptedTypes: string[]
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const text = await res.text()
  const body = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const err = new Error(body.error || `Request failed (${res.status})`) as Error & { body?: unknown }
    err.body = body
    throw err
  }
  return body as T
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  listDrafts: () => request<DraftSummary[]>('/api/drafts'),
  createDraft: (text: string, url: string | null = null) => request<Draft>('/api/drafts', json({ text, url })),
  getDraft: (id: string) => request<Draft>(`/api/drafts/${id}`),
  saveDraft: (draft: Draft) =>
    request<Draft>(`/api/drafts/${draft.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    }),
  deleteDraft: (id: string) => request<{ ok: true }>(`/api/drafts/${id}`, { method: 'DELETE' }),

  uploadMedia: (id: string, files: File[]) => {
    const form = new FormData()
    for (const f of files) form.append('files', f)
    return request<{ draft: Draft; errors: string[] }>(`/api/drafts/${id}/media`, { method: 'POST', body: form })
  },
  patchMedia: (id: string, mediaId: string, body: { description?: string; order?: number }) =>
    request<Draft>(`/api/drafts/${id}/media/${mediaId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  convertMedia: (id: string, mediaId: string) =>
    request<Draft>(`/api/drafts/${id}/media/${mediaId}/convert`, { method: 'POST' }),
  deleteMedia: (id: string, mediaId: string) =>
    request<Draft>(`/api/drafts/${id}/media/${mediaId}`, { method: 'DELETE' }),

  generate: (id: string, body: { platforms?: Platform[]; instruction?: string; useExisting?: boolean }) =>
    request<{ draft: Draft; provider: string; note?: string }>(`/api/drafts/${id}/generate`, json(body)),
  validate: (id: string) => request<Record<Platform, ValidationIssue[]>>(`/api/drafts/${id}/validate`),
  prepare: (id: string, platforms: Platform[]) =>
    request<{ draft: Draft; results: PrepareResult[] }>(`/api/drafts/${id}/prepare`, json({ platforms })),
  openComposer: (id: string, platform: Platform) =>
    request<{ ok: boolean; message: string }>(`/api/drafts/${id}/open`, json({ platform })),
  markPosted: (id: string, platform: Platform, url: string | null, posted = true) =>
    request<Draft>(`/api/drafts/${id}/posted`, json({ platform, url, posted })),

  brand: () => request<Brand>('/api/brand'),
  doctor: () => request<Doctor>('/api/doctor'),
}

export const mediaUrl = (draftId: string, mediaId: string) => `/media/${draftId}/${mediaId}`
