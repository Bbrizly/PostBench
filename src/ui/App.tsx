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

  const draftRef = useRef<Draft | null>(null)
  const dirtyRef = useRef(false)
  const saveTimer = useRef<number | null>(null)
  const saveInFlight = useRef<Promise<void> | null>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('postbench-theme', theme)
  }, [theme])

  const refreshList = useCallback(() => {
    api.listDrafts().then(setSummaries).catch((e) => setToast({ kind: 'error', text: `Could not load drafts: ${e.message}` }))
  }, [])

  useEffect(() => {
    refreshList()
    api.doctor().then(setDoctor).catch((e) => setToast({ kind: 'warn', text: `Setup check failed: ${e.message}` }))
  }, [refreshList])

  /** Replace local state with a canonical server response. */
  const adoptDraft = useCallback((next: Draft) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = null
    dirtyRef.current = false
    draftRef.current = next
    setDraft(next)
    setSaveState('saved')
  }, [])

  /** Apply a local edit immediately and let the autosave coordinator persist it. */
  const editDraft = useCallback((update: (current: Draft) => Draft) => {
    const current = draftRef.current
    if (!current) return
    const next = update(current)
    dirtyRef.current = true
    draftRef.current = next
    setDraft(next)
    setResults([])
  }, [])

  /**
   * Flush the newest local draft before any server action that reads or mutates it.
   * If the user types while a save is in flight, rebase that local edit onto the returned revision
   * and immediately save again instead of replacing it with stale server state.
   */
  const flushDraft = useCallback(async (): Promise<Draft | null> => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = null

    while (true) {
      if (saveInFlight.current) {
        await saveInFlight.current
        continue
      }

      const snapshot = draftRef.current
      if (!snapshot || !dirtyRef.current) {
        setSaveState('saved')
        return snapshot
      }

      dirtyRef.current = false
      setSaveState('saving')
      const task = (async () => {
        try {
          const saved = await api.saveDraft(snapshot)
          const current = draftRef.current
          if (!current || current.id !== snapshot.id) return

          if (current === snapshot) {
            draftRef.current = saved
            setDraft(saved)
          } else if (current.revision === snapshot.revision) {
            const rebased = { ...current, revision: saved.revision, updatedAt: saved.updatedAt }
            draftRef.current = rebased
            setDraft(rebased)
            dirtyRef.current = true
          }
          refreshList()
        } catch (err) {
          dirtyRef.current = true
          throw err
        }
      })()

      saveInFlight.current = task
      try {
        await task
      } finally {
        if (saveInFlight.current === task) saveInFlight.current = null
      }
    }
  }, [refreshList])

  useEffect(() => {
    if (!draft || !dirtyRef.current) return
    setSaveState('saving')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void flushDraft().catch((e) => setToast({ kind: 'error', text: `Could not save: ${e.message}` }))
    }, 600)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
  }, [draft, flushDraft])

  useEffect(() => {
    const onHash = () => {
      const next = routeId()
      void flushDraft()
        .catch((e) => setToast({ kind: 'error', text: `Could not save before navigating: ${e.message}` }))
        .finally(() => setDraftId(next))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [flushDraft])

  useEffect(() => {
    if (!draftId) {
      draftRef.current = null
      dirtyRef.current = false
      setDraft(null)
      return
    }
    api
      .getDraft(draftId)
      .then((d) => {
        adoptDraft(d)
        setResults([])
      })
      .catch((e) => setToast({ kind: 'error', text: e.message }))
  }, [draftId, adoptDraft])

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const openDraft = (id: string) => {
    window.location.hash = `#/d/${encodeURIComponent(id)}`
  }

  const goHome = () => {
    window.location.hash = ''
  }

  /* ---------- media ---------- */

  const uploadFiles = useCallback(
    async (files: File[]) => {
      setUploading(true)
      try {
        const current = await flushDraft()
        if (!current) return
        const { draft: updated, errors } = await api.uploadMedia(current.id, files)
        adoptDraft(updated)
        if (errors.length) setToast({ kind: 'warn', text: errors.join(' ') })
      } catch (e) {
        setToast({ kind: 'error', text: (e as Error).message })
      } finally {
        setUploading(false)
      }
    },
    [adoptDraft, flushDraft],
  )

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const current = draftRef.current
      if (!current || !e.clipboardData) return
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
      editDraft((d) => ({
        ...d,
        source: isUrl
          ? { ...d.source, url: text }
          : { ...d.source, text: d.source.text ? `${d.source.text}\n${text}` : text },
      }))
      setToast({ kind: 'info', text: isUrl ? 'Link added to the draft.' : 'Text pasted into the idea box.' })
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [editDraft, uploadFiles])

  /* ---------- actions ---------- */

  const generate = async (platforms: Platform[], instruction?: string) => {
    setGenerating(platforms.length === 1 ? platforms[0]! : 'all')
    setToast(null)
    try {
      const current = await flushDraft()
      if (!current) return
      const { draft: updated, provider, note } = await api.generate(current.id, {
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
    if (selected.length === 0) return
    setPreparing(true)
    setToast({ kind: 'info', text: 'Opening the Postbench browser…' })
    try {
      const current = await flushDraft()
      if (!current) return
      const { draft: updated, results: nextResults } = await api.prepare(current.id, selected)
      adoptDraft(updated)
      setResults(nextResults)
      const ready = nextResults.filter((r) => r.status === 'ready').length
      setToast(
        ready === nextResults.length
          ? { kind: 'ok', text: 'Composers are verified. Review each one and click Publish yourself.' }
          : { kind: 'warn', text: `${ready}/${nextResults.length} composer(s) fully verified. Check the results below.` },
      )
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message })
    } finally {
      setPreparing(false)
    }
  }

  const setPost = (platform: Platform, post: PlatformPost) =>
    editDraft((d) => ({ ...d, platforms: { ...d.platforms, [platform]: post } }))

  const reorderMedia = async (mediaId: string, order: number) => {
    try {
      const current = await flushDraft()
      if (!current) return
      adoptDraft(await api.patchMedia(current.id, mediaId, { order }))
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message })
    }
  }

  const removeMedia = async (mediaId: string) => {
    try {
      const current = await flushDraft()
      if (!current) return
      adoptDraft(await api.deleteMedia(current.id, mediaId))
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message })
    }
  }

  const convertMedia = async (mediaId: string) => {
    setMediaBusy(mediaId)
    try {
      const current = await flushDraft()
      if (!current) return
      adoptDraft(await api.convertMedia(current.id, mediaId))
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message })
    } finally {
      setMediaBusy(null)
    }
  }

  const markPosted = async (platform: Platform, url: string | null, posted: boolean) => {
    try {
      const current = await flushDraft()
      if (!current) return
      adoptDraft(await api.markPosted(current.id, platform, url, posted))
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message })
    }
  }

  /* ---------- render ---------- */

  return (
    <div className="shell">
      <header className="topbar">
        <span className="wordmark">
          Post<span>bench</span>
        </span>
        {draft && (
          <button type="button" className="btn ghost small" onClick={goHome}>
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
        <DraftList
          summaries={summaries}
          doctor={doctor}
          onOpen={openDraft}
          onRefresh={refreshList}
          onError={(message) => setToast({ kind: 'error', text: message })}
        />
      ) : (
        <>
          <h1>What do you want to post about?</h1>

          <section className="section">
            <textarea
              className="idea"
              value={draft.source.text}
              placeholder="What changed, and why should someone care?"
              onChange={(e) =>
                editDraft((d) => ({ ...d, source: { ...d.source, text: e.target.value } }))
              }
            />
            <div className="row" style={{ marginTop: 10 }}>
              <input
                type="url"
                placeholder="Optional link"
                value={draft.source.url ?? ''}
                onChange={(e) =>
                  editDraft((d) => ({ ...d, source: { ...d.source, url: e.target.value || null } }))
                }
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
                  editDraft((d) => ({
                    ...d,
                    media: d.media.map((m) => (m.id === mediaId ? { ...m, description } : m)),
                  }))
                }
                onReorder={(mediaId, order) => void reorderMedia(mediaId, order)}
                onRemove={(mediaId) => void removeMedia(mediaId)}
                onConvert={(mediaId) => void convertMedia(mediaId)}
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
                  onMarkPosted={(url, posted) => void markPosted(p, url, posted)}
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
  onError,
}: {
  summaries: DraftSummary[]
  doctor: Doctor | null
  onOpen: (id: string) => void
  onRefresh: () => void
  onError: (message: string) => void
}) {
  const [text, setText] = useState('')
  const [creating, setCreating] = useState(false)

  const create = async () => {
    setCreating(true)
    try {
      const next = await api.createDraft(text)
      onRefresh()
      onOpen(next.id)
    } catch (e) {
      onError(`Could not create draft: ${(e as Error).message}`)
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
          placeholder="What changed, and why should someone care?"
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
            <button key={s.id} type="button" className="history-row" onClick={() => onOpen(s.id)}>
              <span className="title">{s.title}</span>
              <span className="spacer" style={{ flex: 1 }} />
              {s.platforms.map((p) => (
                <PlatformIcon key={p} platform={p} size={14} />
              ))}
              <span className={`badge ${s.status}`}>{s.status}</span>
              <span className="when">
                {new Date(s.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            </button>
          ))
        )}
      </section>
    </>
  )
}

export { draftStatus }
