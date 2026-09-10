import { useRef, useState } from 'react'
import type { Draft, Media } from '../../shared/types.js'
import { mediaUrl } from '../api.js'

const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`)
const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export function MediaWorkspace({
  draft,
  onDescribe,
  onReorder,
  onRemove,
  onConvert,
  busyId,
}: {
  draft: Draft
  onDescribe: (mediaId: string, description: string) => void
  onReorder: (mediaId: string, order: number) => void
  onRemove: (mediaId: string) => void
  onConvert: (mediaId: string) => void
  busyId: string | null
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  if (draft.media.length === 0) return null

  return (
    <div className="media-grid">
      {draft.media.map((m: Media, index) => (
        <div
          key={m.id}
          className={`media-card${dragId === m.id ? ' dragging' : ''}${overId === m.id ? ' drop-target' : ''}`}
          draggable
          onDragStart={() => setDragId(m.id)}
          onDragEnd={() => {
            setDragId(null)
            setOverId(null)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setOverId(m.id)
          }}
          onDragLeave={() => setOverId((cur) => (cur === m.id ? null : cur))}
          onDrop={(e) => {
            e.preventDefault()
            setOverId(null)
            if (dragId && dragId !== m.id) onReorder(dragId, index)
          }}
        >
          <div className="media-thumb">
            {m.type === 'image' ? (
              <img src={mediaUrl(draft.id, m.id)} alt={m.name} />
            ) : (
              <video src={mediaUrl(draft.id, m.id)} controls preload="metadata" />
            )}
            <span className="media-badge">
              {m.type === 'video' && m.durationSec ? fmtDuration(m.durationSec) : m.mime.split('/')[1]?.toUpperCase()}
            </span>
          </div>
          <div className="media-meta">
            <div className="media-name" title={m.name}>
              <span className="drag-handle">⠿</span> {m.name}
            </div>
            <div className="media-sub">{fmtSize(m.size)}</div>
            <textarea
              className="media-desc"
              rows={2}
              placeholder="Describe this for the AI…"
              defaultValue={m.description}
              onBlur={(e) => e.target.value !== m.description && onDescribe(m.id, e.target.value)}
            />
            <div className="media-actions">
              {m.mime === 'video/quicktime' && (
                <button
                  type="button"
                  className="btn small"
                  disabled={busyId === m.id}
                  onClick={() => onConvert(m.id)}
                  title="Convert MOV to MP4 with FFmpeg"
                >
                  {busyId === m.id ? 'Converting…' : '→ MP4'}
                </button>
              )}
              <button type="button" className="btn small danger" onClick={() => onRemove(m.id)}>
                × remove
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function Dropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  return (
    <div
      className={`dropzone${over ? ' over' : ''}`}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const files = Array.from(e.dataTransfer.files)
        if (files.length) onFiles(files)
      }}
    >
      <div className="big">Drop your content here</div>
      <div className="sub">Images · Screenshots · Videos</div>
      <div className="hint">or click to choose files · ⌘V pastes a screenshot</div>
      <input
        ref={input}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime"
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) onFiles(files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
