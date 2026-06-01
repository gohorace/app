'use client'

/**
 * PropertyTrail — the agent's own notes on a property (HOR-351 / Property V2).
 *
 * Replaces `NotesThread` on the property surface with a deliberately lighter,
 * single-author "trail": the agent's own observations, no comment-thread
 * chrome (no @mention, reply, react, resolve), and one quiet collaboration
 * line. Reads/writes the same `/api/notes?propertyId=` endpoint, filtered to
 * the current agent's authored notes.
 */
import { useCallback, useEffect, useState } from 'react'
import { Users } from 'lucide-react'

interface TrailNote {
  id: string
  authorId: string
  body: string
  createdAt: string
}

interface NotesResponse {
  notes: Array<{ id: string; authorId: string; body: string; createdAt: string }>
  teammates: Array<{ id: string; firstName: string }>
  currentAgentId: string
}

export function PropertyTrail({ propertyId }: { propertyId: string }) {
  const [notes, setNotes] = useState<TrailNote[]>([])
  const [teammateName, setTeammateName] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/notes?propertyId=${propertyId}`)
      if (!res.ok) return
      const data = (await res.json()) as NotesResponse
      // Single-author trail: the agent's own notes only.
      const mine = data.notes
        .filter((n) => n.authorId === data.currentAgentId)
        .map((n) => ({ id: n.id, authorId: n.authorId, body: n.body, createdAt: n.createdAt }))
      setNotes(mine)
      const other = data.teammates.find((t) => t.id !== data.currentAgentId)
      setTeammateName(other?.firstName ?? null)
    } catch {
      /* best-effort */
    }
  }, [propertyId])

  useEffect(() => {
    void load()
  }, [load])

  async function add() {
    const body = draft.trim()
    if (!body || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, body, mentions: [] }),
      })
      if (!res.ok) {
        setError('Couldn’t save that note — try again.')
        return
      }
      setDraft('')
      await load()
    } catch {
      setError('Couldn’t save that note — try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {notes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          {notes.map((n) => (
            <div key={n.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span
                aria-hidden
                style={{ width: 6, height: 6, borderRadius: '50%', background: '#C4622D', flexShrink: 0, marginTop: 7 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: '#2E2823', textWrap: 'pretty' }}>
                  {n.body}
                </p>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: '#8C7B6B' }}>
                  {relativeWhen(n.createdAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Composer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 10,
          padding: '10px 12px',
          background: '#FFFFFF',
          border: '1px solid rgba(140,123,107,0.2)',
          borderRadius: 10,
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void add()
            }
          }}
          placeholder="Add to your trail…"
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 13.5,
            color: '#1A1612',
            fontFamily: 'var(--font-body)',
            lineHeight: 1.5,
            maxHeight: 120,
          }}
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={!draft.trim() || saving}
          style={{
            padding: '7px 14px',
            borderRadius: 8,
            background: draft.trim() && !saving ? '#1A1612' : 'rgba(140,123,107,0.2)',
            color: draft.trim() && !saving ? '#FAF7F2' : '#8C7B6B',
            border: 'none',
            fontSize: 12.5,
            fontWeight: 500,
            cursor: draft.trim() && !saving ? 'pointer' : 'default',
            fontFamily: 'var(--font-body)',
            whiteSpace: 'nowrap',
          }}
        >
          {saving ? 'Saving…' : 'Add note'}
        </button>
      </div>
      {error && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#9C4A1F' }}>{error}</p>}

      {/* One quiet collaboration line — not a workspace feed. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
        <Users style={{ width: 12, height: 12, color: '#8C7B6B' }} />
        <span style={{ fontSize: 11.5, color: '#8C7B6B' }}>
          {teammateName
            ? `${teammateName} can see your trail on shared properties.`
            : 'Your teammates can see your trail on shared properties.'}
        </span>
      </div>
    </div>
  )
}

function relativeWhen(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  const d = Math.floor(diff / 86_400_000)
  if (d === 1) return 'Yesterday'
  if (d < 7) return `${d} days ago`
  if (d < 30) return `${Math.floor(d / 7)}w ago`
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
