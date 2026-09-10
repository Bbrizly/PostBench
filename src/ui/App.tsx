import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PLATFORMS,
  PLATFORM_LABELS,
  draftStatus,
  validatePlatform,
  type Draft,
  type Platform,
  type PlatformPost,
  type ValidationIssue,
} from '../shared/types.js'
import { api, type Doctor, type DraftSummary, type PrepareResult } from './api.js'
import { Dropzone, MediaWorkspace } from './components/MediaWorkspace.js'
import { PlatformCard } from './components/PlatformCard.js'
import { PlatformIcon, Spinner } from './components/Icons.js'

type Toast = { kind: 'error' | 'ok' | 'info' | 'warn'; text: string } | null

const routeId = () => {
  const m = window.location.hash.match(/^#\/d\/(.+)$/)
  return m?.[1] ? decodeURIComponent(m[1]) : null
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('postbench-theme') || 'light')
  const [draftId, setDraftId] = useState<string | null>(routeId)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [summaries, setSummaries] = useState<DraftSummary[]>([])
  const [doctor, setDoctor] = useState<Doctor | null>(null)
  const [toast, setToast] = useState<Toast>(null)
  const [generating, setGenerating] = useState<Platform | 'all' | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [results, setResults] = useState<PrepareResult[]>([])
  const [mediaBusy, setMediaBusy] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('postbench-theme', theme)
  }, [theme])

  useEffect(() => {
    const onHash = () => setDraftId(routeId())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const refreshList = useCallback(() => {
    api.listDrafts().then(setSummaries).catch(() => {})
  }, [])

  useEffect(() => {
    refreshList()
    api.doctor().then(setDoctor).catch(() => {})
  }, [refreshList])

  useEffect(() => {
    if (!draftId) {
      setDraft(null)
      return
    }
    api
      .getDraft(draftId)
      .then((d) => {
        setDraft(d)
        setResults([])
      })
      .catch((e) => setToast({ kind: 'error', text: e.message }))
  }, [draftId])

  /* ---------- autosave ---------- */

  const saveTimer = useRef<number | null>(null)
  const skipSave = useRef(true)

  useEffect(() => {
    if (!draft) return
    if (skipSave.current) {
      skipSave.current = false
      return
    }
    setSaveState('saving')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      api
        .saveDraft(draft)
        .then(() => {
          setSaveState('saved')
          refreshList()
        })
        .catch((e) => setToast({ kind: 'error', text: `Could not save: ${e.message}` }))
    }, 600)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [draft, refreshList])

  /** Replace the draft from a server response without re-triggering autosave. */
  const adoptDraft = (d: Draft) => {
    skipSave.current = true
    setDraft(d)
  }

  const openDraft = (id: string) => {
    skipSave.current = true
    window.location.hash = `#/d/${encodeURIComponent(id)}`
    setDraftId(id)
  }

  /* ---------- media ---------- */

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!draft) return
      setUploading(true)
      try {
        const { draft: updated, errors } = await api.uploadMedia(draft.id, files)
        adoptDraft(updated)
        if (errors.length) setToast({ kind: 'warn', text: errors.join(' ') })
      } catch (e) {
        setToast({ kind: 'error', text: (e as Error).message })
      } finally {
        setUploading(false)
      }
    },
    [draft],
  )

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!draft || !e.clipboardData) return
      const files = Array.from(e.clipboardData.files)
      if (files.length) {
        e.preventDefault()
        void uploadFiles(files)
        return
      }
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return
      const text = e.clipboardData.getData('text/plain').trim()
      if (!text) return
      e.preventDefault()
      const isUrl = /^https?:\/\/\S+$/.test(text)
      setDraft((d) =>
        d
          ? {
              ...d,
              source: isUrl
                ? { ...d.source, url: text }
                : { ...d.source, text: d.source.text ? `${d.source.text}\n${text}` : text },
            }
          : d,
      )
      setToast({ kind: 'info', text: isUrl ? 'Link added to the draft.' : 'Text pasted into the idea box.' })
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [draft, uploadFiles])

  /* ---------- actions ---------- */

  const generate = async (platforms: Platform[], instruction?: string) => {
    if (!draft) return
    setGenerating(platforms.length === 1 ? platforms[0]! : 'all')
    setToast(null)
    try {
      const { draft: updated, provider, note } = await api.generate(draft.id, {
        platforms,
        instruction,
        useExisting: platforms.length === 1 && Boolean(instruction),
      })
      adoptDraft(updated)
      setToast(note ? { kind: 'warn', text: note } : { kind: 'ok', text: `Generated with ${provider}.` })
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message })
    } finally {
      setGenerating(null)
    }
  }

  const selected = useMemo(
    () => (draft ? PLATFORMS.filter((p) => draft.platforms[p].enabled) : []),
    [draft],
  )

  const issues = useMemo(() => {
    const out = {} as Record<Platform, ValidationIssue[]>
    for (const p of PLATFORMS) out[p] = draft ? validatePlatform(p, draft.platforms[p], draft.media) : []
    return out
  }, [draft])

  const blockingErrors = selected.flatMap((p) => issues[p].filter((i) => i.level === 'error'))

  const prepare = async () => {
    if (!draft || selected.length === 0) return
    setPreparing(true)
    setToast({ kind: 'info', text: 'Opening the Postbench browser…' })
    try {
      const { draft: updated, results: r } = await api.prepare(draft.id, selected)
      adoptDraft(updated)
      setResults(r)
      setToast({ kind: 'ok', text: 'Composers are open. Review each one and click Publish yourself.' })
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message })
    } finally {
      setPreparing(false)
    }
  }

  const setPost = (platform: Platform, post: PlatformPost) =>
    setDraft((d) => (d ? { ...d, platforms: { ...d.platforms, [platform]: post } } : d))

  /* ---------- render ---------- */

  return (
    <div className="shell">
      <header className="topbar">
        <span className="wordmark">
          Post<span>bench</span>
        </span>
        {draft && (
          <button type="button" className="btn ghost small" onClick={() => (window.location.hash = '')}>
            ← All drafts
          </button>
        )}
        <span className="spacer" />
        {draft && <span className="save-state">{saveState === 'saving' ? 'saving…' : 'saved'}</span>}
        <button type="button" className="btn ghost small" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? '☀︎ Light' : '☾ Dark'}
        </button>
      </header>

      {toast && (
        <div className={`notice ${toast.kind}`} style={{ marginBottom: 20 }}>
          <span style={{ flex: 1 }}>{toast.text}</span>
          <button type="button" className="btn ghost small" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}

      {!draft ? (
        <DraftList summaries={summaries} doctor={doctor} onOpen={openDraft} onRefresh={refreshList} />
      ) : (
        <>
          <h1>What do you want to post about?</h1>

          <section className="section">
            <textarea
              className="idea"
              value={draft.source.text}
              placeholder="Faultbench can now search HVAC manuals completely offline."
              onChange={(e) => setDraft({ ...draft, source: { ...draft.source, text: e.target.value } })}
            />
            <div className="row" style={{ marginTop: 10 }}>
              <input
                type="url"
                placeholder="Optional link"
                value={draft.source.url ?? ''}
                onChange={(e) => setDraft({ ...draft, source: { ...draft.source, url: e.target.value || null } })}
                style={{ maxWidth: 320 }}
              />
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className="btn primary"
                disabled={generating !== null}
                onClick={() => generate([...PLATFORMS])}
              >
                {generating === 'all' ? <Spinner /> : null} Generate
              </button>
            </div>
          </section>

          <section className="section">
            <Dropzone onFiles={uploadFiles} />
            {uploading && (
              <div className="notice info" style={{ marginTop: 10 }}>
                <Spinner /> Uploading…
              </div>
            )}
          </section>

          {draft.media.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>Media</h2>
                <span className="media-sub">{draft.media.length} file(s) · drag to reorder</span>
              </div>
              <MediaWorkspace
                draft={draft}
                busyId={mediaBusy}
                onDescribe={(mediaId, description) =>
                  api.patchMedia(draft.id, mediaId, { description }).then(adoptDraft).catch((e) =>
                    setToast({ kind: 'error', text: e.message }),
                  )
                }
                onReorder={(mediaId, order) =>
                  api.patchMedia(draft.id, mediaId, { order }).then(adoptDraft).catch((e) =>
                    setToast({ kind: 'error', text: e.message }),
                  )
                }
                onRemove={(mediaId) =>
                  api.deleteMedia(draft.id, mediaId).then(adoptDraft).catch((e) =>
                    setToast({ kind: 'error', text: e.message }),
                  )
                }
                onConvert={(mediaId) => {
                  setMediaBusy(mediaId)
                  api
                    .convertMedia(draft.id, mediaId)
                    .then(adoptDraft)
                    .catch((e) => setToast({ kind: 'error', text: e.message }))
                    .finally(() => setMediaBusy(null))
                }}
              />
            </section>
          )}

          <section className="section">
            <div className="section-head">
              <h2>Posts</h2>
            </div>
            <div className="cards">
              {PLATFORMS.map((p) => (
                <PlatformCard
                  key={p}
                  platform={p}
                  draft={draft}
                  issues={issues[p]}
                  busy={generating === p || generating === 'all'}
                  onChange={(post) => setPost(p, post)}
                  onGenerate={(instruction) => generate([p], instruction)}
                  onOpen={() =>
                    api
                      .openComposer(draft.id, p)
                      .then((r) => setToast({ kind: r.ok ? 'ok' : 'error', text: r.message }))
                      .catch((e) => setToast({ kind: 'error', text: e.message }))
                  }
                  onMarkPosted={(url, posted) =>
                    api.markPosted(draft.id, p, url, posted).then(adoptDraft).catch((e) =>
                      setToast({ kind: 'error', text: e.message }),
                    )
                  }
                />
              ))}
            </div>
          </section>

          {results.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>Ready to post</h2>
              </div>
              <div className="status-list">
                {results.map((r) => (
                  <div key={r.platform} className="status-item">
                    <div className="head">
                      <PlatformIcon platform={r.platform} />
                      {PLATFORM_LABELS[r.platform]}
                      <span className={`badge ${r.status === 'ready' ? 'posted' : r.status === 'failed' ? '' : 'partial'}`}>
                        {r.status}
                      </span>
                    </div>
                    <div className="media-sub" style={{ fontFamily: 'inherit', fontSize: 13 }}>
                      {r.message}
                    </div>
                    {r.details.length > 0 && (
                      <ul>
                        {r.details.map((d) => (
                          <li key={d}>✓ {d}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="prepare-bar">
            <div className="inner">
              <span className="summary">
                {selected.length === 0
                  ? 'No platforms selected.'
                  : blockingErrors.length > 0
                    ? `${blockingErrors.length} problem(s) to fix before preparing.`
                    : 'Postbench fills the composers. You click Publish.'}
              </span>
              <span className="spacer" />
              <button
                type="button"
                className="btn primary"
                disabled={preparing || selected.length === 0 || blockingErrors.length > 0}
                onClick={prepare}
              >
                {preparing ? <Spinner /> : null}
                {selected.length === 0
                  ? 'Prepare Selected Posts'
                  : `Prepare ${selected.map((p) => PLATFORM_LABELS[p]).join(' + ')}`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function DraftList({
  summaries,
  doctor,
  onOpen,
  onRefresh,
}: {
  summaries: DraftSummary[]
  doctor: Doctor | null
  onOpen: (id: string) => void
  onRefresh: () => void
}) {
  const [text, setText] = useState('')
  const [creating, setCreating] = useState(false)

  const create = async () => {
    setCreating(true)
    try {
      const draft = await api.createDraft(text)
      onRefresh()
      onOpen(draft.id)
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <h1>What do you want to post about?</h1>
      <section className="section">
        <textarea
          className="idea"
          value={text}
          placeholder="Faultbench can now search HVAC manuals completely offline."
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className="btn primary" disabled={creating} onClick={create}>
            {creating ? <Spinner /> : null} New draft
          </button>
          {doctor && (
            <span className="media-sub">
              AI: {doctor.aiProvider ?? 'none'} · Playwright: {doctor.playwrightInstalled ? 'ok' : 'missing'} · FFmpeg:{' '}
              {doctor.ffmpeg ? 'ok' : 'missing'}
            </span>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Drafts</h2>
        </div>
        {summaries.length === 0 ? (
          <div className="empty">No drafts yet.</div>
        ) : (
          summaries.map((s) => (
            <div key={s.id} className="history-row" onClick={() => onOpen(s.id)}>
              <span className="title">{s.title}</span>
              <span className="spacer" style={{ flex: 1 }} />
              {s.platforms.map((p) => (
                <PlatformIcon key={p} platform={p} size={14} />
              ))}
              <span className={`badge ${s.status}`}>{s.status}</span>
              <span className="when">
                {new Date(s.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            </div>
          ))
        )}
      </section>
    </>
  )
}

export { draftStatus }
