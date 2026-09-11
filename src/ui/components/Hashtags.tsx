import { useState } from 'react'
import { addHashtag, removeHashtag } from '../../shared/types.js'

export function Hashtags({
  selected,
  suggested,
  onChange,
}: {
  selected: string[]
  suggested: string[]
  onChange: (selected: string[], suggested: string[]) => void
}) {
  const [custom, setCustom] = useState('')

  const remove = (tag: string) => onChange(removeHashtag(selected, tag), addHashtag(suggested, tag))
  const add = (tag: string) => onChange(addHashtag(selected, tag), removeHashtag(suggested, tag))

  const commitCustom = () => {
    if (!custom.trim()) return
    onChange(addHashtag(selected, custom), suggested)
    setCustom('')
  }

  return (
    <div>
      <div className="field-label">Hashtags — click to remove</div>
      <div className="chips">
        {selected.length === 0 && <span className="media-sub">none</span>}
        {selected.map((tag) => (
          <button key={tag} type="button" className="chip" onClick={() => remove(tag)} title="Remove">
            #{tag}
          </button>
        ))}
        <input
          className="chip-input"
          placeholder="+ custom"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onBlur={commitCustom}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitCustom()
            }
          }}
        />
      </div>

      {suggested.length > 0 && (
        <>
          <div className="field-label" style={{ marginTop: 12 }}>
            Suggested
          </div>
          <div className="chips">
            {suggested.map((tag) => (
              <button key={tag} type="button" className="chip suggestion" onClick={() => add(tag)}>
                + {tag}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
