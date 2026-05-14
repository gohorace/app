'use client'

import { useState } from 'react'

/**
 * Inline notes editor used on both Property Detail and Contact Detail.
 * Auto-saves on blur via PATCH `endpoint` with `{ notes: string | null }`.
 *
 * Surface contract for the API:
 *   PATCH endpoint accepts `{ notes: string | null }` where:
 *     - empty/whitespace string OR null → clear the note
 *     - non-empty string → set the note (server should `.trim()` if needed)
 *
 * Server should store at metadata.notes (properties) or notes column
 * (contacts) — the panel doesn't care; that's a server-side concern.
 *
 * UI states:
 *   - 'idle'   — no transient affordance, just the textarea
 *   - 'saving' — pill reads "Saving…"
 *   - 'saved'  — pill reads "Saved", auto-clears after 1.6s
 *   - 'error'  — pill reads "Save failed", error text appears below
 */

interface NotesPanelProps {
  /** PATCH target URL. Receives `{ notes }` as the JSON body. */
  endpoint: string
  /** Pre-existing note for this record. Null if none / column missing. */
  initial: string | null
  /** Subtitle copy under "Notes". Defaults to the property-detail line. */
  subtitle?: string
  /** Placeholder text in the textarea. Defaults to a property-flavoured hint. */
  placeholder?: string
  /** Max length the server will accept. Server should mirror; UI clamps too. */
  maxLength?: number
}

export function NotesPanel({
  endpoint,
  initial,
  subtitle = 'A space for yourself. Horace keeps them with the record — visible to everyone in your workspace.',
  placeholder,
  maxLength = 2000,
}: NotesPanelProps) {
  const [value, setValue] = useState(initial ?? '')
  const [savedValue, setSavedValue] = useState(initial ?? '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function persist(next: string) {
    if (next === savedValue) {
      setStatus('idle')
      return
    }
    setStatus('saving')
    setError(null)
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: next.trim().length === 0 ? null : next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error ?? 'Could not save notes')
        setStatus('error')
        return
      }
      setSavedValue(next)
      setStatus('saved')
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1600)
    } catch {
      setError('Network error — try again')
      setStatus('error')
    }
  }

  return (
    <section
      style={{
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.18)',
        borderRadius: 10,
        padding: '20px 22px',
        marginBottom: 18,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 16,
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2
            className="font-display"
            style={{
              fontSize: 20,
              fontWeight: 500,
              color: '#1A1612',
              letterSpacing: '-0.01em',
              margin: '0 0 2px',
            }}
          >
            Notes
          </h2>
          <p style={{ margin: 0, fontSize: 12, color: '#8C7B6B' }}>{subtitle}</p>
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color:
              status === 'saving' ? '#8C7B6B'
              : status === 'saved'  ? '#3D5246'
              : status === 'error'  ? '#9C4A1F'
              : 'transparent',
            transition: 'color 180ms',
          }}
        >
          {status === 'saving' && 'Saving…'}
          {status === 'saved'  && 'Saved'}
          {status === 'error'  && 'Save failed'}
          {status === 'idle'   && '·'}
        </span>
      </div>

      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => persist(value)}
        placeholder={placeholder}
        rows={4}
        maxLength={maxLength}
        style={{
          width: '100%',
          minHeight: 90,
          padding: '12px 14px',
          fontSize: 13,
          lineHeight: 1.55,
          fontFamily: 'var(--font-body)',
          color: '#1A1612',
          background: '#FFFFFF',
          border: '1px solid rgba(140,123,107,0.22)',
          borderRadius: 8,
          outline: 'none',
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />

      {error && (
        <p
          role="alert"
          style={{ marginTop: 8, fontSize: 12, color: '#9C4A1F' }}
        >
          {error}
        </p>
      )}
    </section>
  )
}
