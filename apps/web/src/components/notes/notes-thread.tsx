'use client'

import { useMemo, useRef, useState } from 'react'
import { AtSign, Check, MessageSquare, Smile, Pencil } from 'lucide-react'
import { useNotes } from '@/lib/notes/use-notes'
import type { Note, NoteTeammate, NotesTarget } from '@/lib/notes/types'

/**
 * NotesThread — v2 threaded, @mentionable comment log (HOR-252).
 * Replaces the single-textarea NotesPanel on contact + property detail.
 * Positioning: a team coordination log (Andy signed off on the
 * CLAUDE.md rule-2 tension), not CRM deal-tracking.
 *
 * Mention model (plain-textarea friendly): the body stores `@FirstName`
 * tokens; `mentions[]` carries the resolved agent ids. Pills are rendered
 * by matching mentioned teammates' first names in the body. Reply + React
 * are visual-only in v2.0 ("Coming soon") — backend is HOR-256 (v2-D3).
 */

interface NotesThreadProps extends NotesTarget {
  /** "contact" / "property" — drives empty-state copy. */
  subjectKind: 'contact' | 'property'
}

export function NotesThread({ contactId, propertyId, subjectKind }: NotesThreadProps) {
  const target: NotesTarget = contactId ? { contactId } : { propertyId }
  const { notes, teammates, currentAgentId, loading, tableMissing, createNote, resolveNote, editNote } =
    useNotes(target)

  return (
    <section
      style={{
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.2)',
        borderRadius: 12,
        padding: '18px 20px',
      }}
    >
      <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: '#1A1612' }}>Notes</h2>
      <p style={{ margin: '0 0 14px', fontSize: 12, color: '#8C7B6B' }}>
        Shared with everyone in your workspace. Mention @teammate to loop them in.
      </p>

      {!loading && notes.length === 0 ? (
        <p
          className="font-display"
          style={{ margin: '8px 0 16px', fontStyle: 'italic', fontSize: 14, color: '#8C7B6B', lineHeight: 1.5 }}
        >
          No notes on this {subjectKind} yet. Type below — mention @teammate to loop them in.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
          {notes.map((n) => (
            <NoteRow
              key={n.id}
              note={n}
              teammates={teammates}
              currentAgentId={currentAgentId}
              onResolve={(resolved) => resolveNote(n.id, resolved)}
              onEdit={(body) => editNote(n.id, body)}
            />
          ))}
        </div>
      )}

      <Composer teammates={teammates} currentAgentId={currentAgentId} onPost={createNote} />

      {tableMissing && (
        <p style={{ marginTop: 8, fontSize: 11, color: '#9C4A1F' }}>
          Notes aren&rsquo;t available yet — the database migration is pending.
        </p>
      )}
    </section>
  )
}

// ── Note row ─────────────────────────────────────────────────────────────────

function NoteRow({
  note,
  teammates,
  currentAgentId,
  onResolve,
  onEdit,
}: {
  note: Note
  teammates: NoteTeammate[]
  currentAgentId: string
  onResolve: (resolved: boolean) => void
  onEdit: (body: string) => Promise<boolean>
}) {
  const [hover, setHover] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.body)
  const isAuthor = note.authorId === currentAgentId

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        gap: 10,
        padding: '10px 8px',
        borderRadius: 8,
        background: note.resolved ? 'rgba(140,123,107,0.06)' : 'transparent',
        opacity: note.resolved ? 0.7 : 1,
      }}
    >
      <Avatar initials={note.authorInitials} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1612' }}>{note.authorName}</span>
          {note.authorRole && (
            <span style={{ fontSize: 11, color: '#8C7B6B' }}>{note.authorRole}</span>
          )}
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: '#8C7B6B' }}>
            {relativeWhen(note.createdAt)}
            {note.editedAt ? ' · edited' : ''}
          </span>
        </div>

        {editing ? (
          <div style={{ marginTop: 6 }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              style={editTextareaStyle}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button
                type="button"
                onClick={async () => {
                  const ok = await onEdit(draft.trim())
                  if (ok) setEditing(false)
                }}
                style={miniPrimaryBtn}
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(note.body)
                  setEditing(false)
                }}
                style={miniGhostBtn}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p style={{ margin: '3px 0 0', fontSize: 13, color: '#2E2823', lineHeight: 1.55 }}>
            {renderBodyWithMentions(note.body, note.mentions, teammates, currentAgentId)}
          </p>
        )}

        {/* Hover actions */}
        {hover && !editing && (
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <RowAction icon={MessageSquare} label="Reply" comingSoon />
            <RowAction icon={Smile} label="React" comingSoon />
            {isAuthor && <RowAction icon={Pencil} label="Edit" onClick={() => setEditing(true)} />}
            <RowAction
              icon={Check}
              label={note.resolved ? 'Reopen' : 'Resolve'}
              onClick={() => onResolve(!note.resolved)}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function RowAction({
  icon: Icon,
  label,
  onClick,
  comingSoon,
}: {
  icon: typeof Check
  label: string
  onClick?: () => void
  comingSoon?: boolean
}) {
  return (
    <button
      type="button"
      onClick={comingSoon ? undefined : onClick}
      title={comingSoon ? `${label} — coming soon` : label}
      className="row-action-btn"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        fontSize: 11,
        fontWeight: 500,
        color: comingSoon ? '#A8998A' : '#5E5246',
        background: 'transparent',
        border: '1px solid rgba(140,123,107,0.22)',
        borderRadius: 6,
        cursor: comingSoon ? 'default' : 'pointer',
        fontFamily: 'var(--font-body)',
      }}
    >
      <Icon style={{ width: 11, height: 11 }} aria-hidden /> {label}
    </button>
  )
}

// ── Composer ─────────────────────────────────────────────────────────────────

function Composer({
  teammates,
  currentAgentId,
  onPost,
}: {
  teammates: NoteTeammate[]
  currentAgentId: string
  onPost: (input: { body: string; mentions: string[] }) => Promise<boolean>
}) {
  const [value, setValue] = useState('')
  const [picked, setPicked] = useState<Map<string, string>>(new Map()) // agentId → firstName
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [posting, setPosting] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  const me = teammates.find((t) => t.id === currentAgentId)

  const filtered = useMemo(() => {
    const q = pickerQuery.toLowerCase()
    return teammates.filter((t) => t.id !== currentAgentId && t.name.toLowerCase().includes(q)).slice(0, 6)
  }, [teammates, pickerQuery, currentAgentId])

  function onChange(next: string) {
    setValue(next)
    // Detect an active @token at the end of the typed text.
    const m = /(^|\s)@(\w*)$/.exec(next.slice(0, ref.current?.selectionStart ?? next.length))
    if (m) {
      setPickerOpen(true)
      setPickerQuery(m[2])
    } else {
      setPickerOpen(false)
    }
  }

  function insertMention(t: NoteTeammate) {
    // Replace the trailing @token with @FirstName + a space.
    const next = value.replace(/(^|\s)@(\w*)$/, (_full, pre) => `${pre}@${t.firstName} `)
    setValue(next)
    setPicked((prev) => new Map(prev).set(t.id, t.firstName))
    setPickerOpen(false)
    ref.current?.focus()
  }

  async function post() {
    const text = value.trim()
    if (!text || posting) return
    // Resolve mentions: any picked teammate whose @FirstName still appears.
    const mentions = [...picked.entries()]
      .filter(([, first]) => new RegExp(`@${escapeRe(first)}\\b`).test(text))
      .map(([id]) => id)
    setPosting(true)
    const ok = await onPost({ body: text, mentions })
    setPosting(false)
    if (ok) {
      setValue('')
      setPicked(new Map())
    }
  }

  const hasContent = value.trim().length > 0

  return (
    <div style={{ position: 'relative', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <Avatar initials={me?.initials ?? '?'} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            padding: '8px 10px',
            background: '#FFFFFF',
            border: '1px solid rgba(140,123,107,0.25)',
            borderRadius: 10,
          }}
        >
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !pickerOpen) {
                e.preventDefault()
                void post()
              }
              if (e.key === 'Escape') setPickerOpen(false)
            }}
            placeholder="Write a note… @mention a teammate to loop them in"
            rows={2}
            aria-label="Write a note"
            style={{
              flex: 1,
              resize: 'none',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 13,
              color: '#1A1612',
              fontFamily: 'var(--font-body)',
              lineHeight: 1.5,
            }}
          />
          <button
            type="button"
            aria-label="Mention a teammate"
            onClick={() => {
              setValue((v) => `${v}${v && !v.endsWith(' ') ? ' ' : ''}@`)
              setPickerOpen(true)
              setPickerQuery('')
              ref.current?.focus()
            }}
            style={iconBtn}
          >
            <AtSign style={{ width: 14, height: 14 }} />
          </button>
          <button
            type="button"
            onClick={post}
            disabled={!hasContent || posting}
            style={{
              padding: '7px 13px',
              fontSize: 12.5,
              fontWeight: 500,
              color: hasContent ? '#FAF7F2' : '#8C7B6B',
              background: hasContent ? '#1A1612' : 'rgba(140,123,107,0.15)',
              border: 'none',
              borderRadius: 7,
              cursor: hasContent && !posting ? 'pointer' : 'default',
              fontFamily: 'var(--font-body)',
              whiteSpace: 'nowrap',
            }}
          >
            {posting ? 'Posting…' : 'Post note'}
          </button>
        </div>

        {/* Mention picker */}
        {pickerOpen && filtered.length > 0 && (
          <div
            style={{
              position: 'absolute',
              left: 44,
              right: 0,
              marginTop: 4,
              background: '#FAF7F2',
              border: '1px solid rgba(140,123,107,0.25)',
              borderRadius: 8,
              boxShadow: 'var(--shadow-md)',
              padding: 4,
              zIndex: 20,
            }}
          >
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => insertMention(t)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '7px 8px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'var(--font-body)',
                }}
                className="settings-nav-row"
              >
                <Avatar initials={t.initials} size={24} />
                <span style={{ fontSize: 13, color: '#1A1612', fontWeight: 500 }}>{t.name}</span>
                {t.role && <span style={{ fontSize: 11, color: '#8C7B6B' }}>{t.role}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Bits ─────────────────────────────────────────────────────────────────────

function Avatar({ initials, size = 30 }: { initials: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'rgba(196,98,45,0.18)',
        color: '#C4622D',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-display)',
        fontSize: size >= 30 ? 12 : 10,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {initials}
    </span>
  )
}

/**
 * Render the body, wrapping `@FirstName` tokens for mentioned teammates as
 * pills. The current user's own mention pill reads darker.
 */
function renderBodyWithMentions(
  body: string,
  mentions: string[],
  teammates: NoteTeammate[],
  currentAgentId: string,
): React.ReactNode {
  const mentioned = teammates.filter((t) => mentions.includes(t.id))
  if (mentioned.length === 0) return body

  // Build a single regex of all mentioned first names (longest first to
  // avoid partial shadowing).
  const names = mentioned
    .map((t) => t.firstName)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
  if (names.length === 0) return body
  const re = new RegExp(`@(${names.join('|')})\\b`, 'g')

  const parts: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) parts.push(body.slice(last, m.index))
    const first = m[1]
    const t = mentioned.find((x) => x.firstName === first)
    const isMe = t?.id === currentAgentId
    parts.push(
      <span
        key={key++}
        style={{
          background: isMe ? 'rgba(196,98,45,0.22)' : 'rgba(196,98,45,0.12)',
          color: isMe ? '#8A3D12' : '#A85220',
          fontWeight: 500,
          padding: '0 4px',
          borderRadius: 4,
        }}
      >
        @{first}
      </span>,
    )
    last = m.index + m[0].length
  }
  if (last < body.length) parts.push(body.slice(last))
  return parts
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function relativeWhen(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

const editTextareaStyle: React.CSSProperties = {
  width: '100%',
  resize: 'none',
  fontSize: 13,
  color: '#1A1612',
  background: '#FFFFFF',
  border: '1px solid rgba(140,123,107,0.28)',
  borderRadius: 6,
  padding: '6px 8px',
  outline: 'none',
  fontFamily: 'var(--font-body)',
  boxSizing: 'border-box',
}
const miniPrimaryBtn: React.CSSProperties = {
  padding: '5px 11px',
  fontSize: 12,
  fontWeight: 500,
  color: '#FAF7F2',
  background: '#1A1612',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
}
const miniGhostBtn: React.CSSProperties = {
  padding: '5px 11px',
  fontSize: 12,
  color: '#5E5246',
  background: 'transparent',
  border: '1px solid rgba(140,123,107,0.3)',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
}
const iconBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 7,
  background: 'transparent',
  border: '1px solid rgba(140,123,107,0.25)',
  color: '#8C7B6B',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  flexShrink: 0,
}
