import { useState } from 'react'
import {
  PLATFORM_LABELS,
  PLATFORM_LIMITS,
  composeText,
  countCharacters,
  type Draft,
  type Platform,
  type PlatformPost,
  type ValidationIssue,
} from '../../shared/types.js'
import { mediaUrl } from '../api.js'
import { Hashtags } from './Hashtags.js'
import { PlatformIcon, Spinner } from './Icons.js'

const TRANSFORMS: { label: string; instruction: string }[] = [
  { label: 'Shorter', instruction: 'Rewrite this post so it is noticeably shorter. Keep the same point.' },
  { label: 'More casual', instruction: 'Rewrite this post in a more casual, spoken tone.' },
  { label: 'More technical', instruction: 'Rewrite this post with more concrete technical detail for practitioners.' },
  { label: 'Less promotional', instruction: 'Rewrite this post so it reads less like marketing and more like a note from a builder.' },
]

export function PlatformCard({
  platform,
  draft,
  issues,
  busy,
  onChange,
  onGenerate,
  onOpen,
  onMarkPosted,
}: {
  platform: Platform
  draft: Draft
  issues: ValidationIssue[]
  busy: boolean
  onChange: (post: PlatformPost) => void
  onGenerate: (instruction?: string) => void
  onOpen: () => void
  onMarkPosted: (url: string | null, posted: boolean) => void
}) {
  const post = draft.platforms[platform]
  const [showPreview, setShowPreview] = useState(false)
  const [copied, setCopied] = useState(false)
  const [postUrl, setPostUrl] = useState('')

  const composed = composeText(post)
  const count = countCharacters(composed, platform)
  const limit = PLATFORM_LIMITS[platform].maxChars
  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warning')

  const patch = (p: Partial<PlatformPost>) => onChange({ ...post, ...p })

  const toggleMedia = (id: string) =>
    patch({
      mediaIds: post.mediaIds.includes(id) ? post.mediaIds.filter((m) => m !== id) : [...post.mediaIds, id],
    })

  const copy = async () => {
    await navigator.clipboard.writeText(composed)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <section className={`card${post.enabled ? '' : ' off'}`}>
      <div className="card-head">
        <span className="card-title">
          <PlatformIcon platform={platform} />
          {PLATFORM_LABELS[platform]}
        </span>
        <span className="spacer" />
        {post.posted && <span className="badge posted">posted</span>}
        {!post.posted && post.prepared?.status === 'ready' && <span className="badge prepared">prepared</span>}
        <button
          type="button"
          className="toggle"
          data-on={post.enabled}
          aria-label={`${post.enabled ? 'Disable' : 'Enable'} ${PLATFORM_LABELS[platform]}`}
          onClick={() => patch({ enabled: !post.enabled })}
        />
      </div>

      <textarea
        className="post-text"
        value={post.text}
        placeholder={`Nothing generated for ${PLATFORM_LABELS[platform]} yet.`}
        onChange={(e) => patch({ text: e.target.value })}
      />

      <div className="row">
        <span className={`count${count > limit ? ' over' : ''}`}>
          {count} / {limit} characters
        </span>
        <span className="spacer" style={{ flex: 1 }} />
        <button type="button" className="btn ghost small" onClick={() => setShowPreview((v) => !v)}>
          {showPreview ? 'Hide preview' : 'Preview'}
        </button>
      </div>

      {showPreview && <div className="preview">{composed || '(empty)'}</div>}

      <Hashtags
        selected={post.hashtags}
        suggested={post.suggestedHashtags}
        onChange={(hashtags, suggestedHashtags) => patch({ hashtags, suggestedHashtags })}
      />

      <div>
        <div className="field-label">Media for {PLATFORM_LABELS[platform]}</div>
        {draft.media.length === 0 ? (
          <div className="media-sub">No media in the workspace.</div>
        ) : (
          <div className="picker">
            {draft.media.map((m) => (
              <label key={m.id}>
                <input type="checkbox" checked={post.mediaIds.includes(m.id)} onChange={() => toggleMedia(m.id)} />
                {m.type === 'image' ? (
                  <img className="thumb" src={mediaUrl(draft.id, m.id)} alt="" />
                ) : (
                  <span className="thumb" />
                )}
                <span>{m.name}</span>
                <span className="kind">{m.type}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {errors.length > 0 && (
        <div className="notice error">
          <ul>
            {errors.map((i) => (
              <li key={i.message}>{i.message}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="notice warn">
          <ul>
            {warnings.map((i) => (
              <li key={i.message}>{i.message}</li>
            ))}
          </ul>
        </div>
      )}
      {post.prepared && (
        <div className={`notice ${post.prepared.status === 'ready' ? 'ok' : post.prepared.status === 'partial' ? 'warn' : 'error'}`}>
          {post.prepared.message}
        </div>
      )}

      <div className="row">
        <button type="button" className="btn small" disabled={busy} onClick={() => onGenerate()}>
          {busy ? <Spinner /> : null} Regenerate
        </button>
        {TRANSFORMS.map((t) => (
          <button key={t.label} type="button" className="btn small" disabled={busy} onClick={() => onGenerate(t.instruction)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="row">
        <button type="button" className="btn small" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <button type="button" className="btn small" onClick={onOpen}>
          Open {PLATFORM_LABELS[platform]}
        </button>
        <span style={{ flex: 1 }} />
        {post.posted ? (
          <button type="button" className="btn small ghost" onClick={() => onMarkPosted(null, false)}>
            Undo posted
          </button>
        ) : (
          <>
            <input
              type="text"
              placeholder="post URL (optional)"
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              style={{ width: 190, padding: '4px 10px', borderRadius: 7, fontSize: 12 }}
            />
            <button type="button" className="btn small" onClick={() => onMarkPosted(postUrl.trim() || null, true)}>
              Mark as posted
            </button>
          </>
        )}
      </div>
    </section>
  )
}
