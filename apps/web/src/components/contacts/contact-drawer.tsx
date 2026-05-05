'use client'

import { useEffect, useState, useRef } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  X, Phone, Mail, MapPin, Home, ChevronUp, ChevronDown,
  Eye, FileText, RotateCcw, BookOpen, Pencil, Check,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type Intent = 'high' | 'mid' | 'low' | 'none'

type RawEvent = {
  event_id:    string
  event_type:  string
  properties:  Record<string, unknown>
  score_delta: number
  occurred_at: string
}

type MergedEvent = RawEvent & { scroll_pct?: number }

// ── Intent config ─────────────────────────────────────────────────────────────

function getIntent(score: number): Intent {
  if (score >= 50) return 'high'
  if (score >= 20) return 'mid'
  if (score >= 5)  return 'low'
  return 'none'
}

const INTENT_LABEL: Record<Intent, string> = {
  high: 'High intent', mid: 'Mid intent', low: 'Watching', none: 'Quiet',
}
const INTENT_FG: Record<Intent, string> = {
  high: '#A5511E', mid: '#8A6A00', low: '#3D5246', none: '#6B5A4A',
}
const INTENT_BG: Record<Intent, string> = {
  high: 'rgba(196,98,45,0.1)', mid: 'rgba(181,146,42,0.1)',
  low:  'rgba(61,82,70,0.1)',  none: 'rgba(140,123,107,0.1)',
}
const INTENT_DOT: Record<Intent, string> = {
  high: '#C4622D', mid: '#B5922A', low: '#3D5246', none: '#8C7B6B',
}

// ── Event merging ─────────────────────────────────────────────────────────────

function mergeScrollDepth(events: RawEvent[]): MergedEvent[] {
  const scrollByUrl = new Map<string, number>()
  for (const e of events) {
    if (e.event_type !== 'scroll_depth') continue
    const url = String(e.properties.url ?? e.properties.path ?? '')
    const pct = typeof e.properties.pct === 'number' ? e.properties.pct : 90
    if (url && (!scrollByUrl.has(url) || pct > scrollByUrl.get(url)!)) {
      scrollByUrl.set(url, pct)
    }
  }
  const merged: MergedEvent[] = []
  for (const e of events) {
    if (e.event_type === 'scroll_depth') continue
    if (e.event_type === 'campaign_click') continue
    const url = String(e.properties.url ?? e.properties.path ?? '')
    const pct = url ? scrollByUrl.get(url) : undefined
    merged.push({ ...e, scroll_pct: pct })
  }
  return merged
}

// ── Event labels ──────────────────────────────────────────────────────────────

function eventLabel(event: MergedEvent): string {
  const p = event.properties
  switch (event.event_type) {
    case 'property_view': {
      const addr = p.address ?? p.title
      const pct  = event.scroll_pct
      const verb = pct !== undefined ? pct >= 75 ? 'Spent time on' : pct >= 40 ? 'Looked through' : 'Browsed' : 'Browsed'
      return addr ? `${verb} a listing — ${addr}` : 'Viewed a property listing'
    }
    case 'form_submit': {
      const form = p.form_name ?? p.form_id
      return form ? `Submitted "${form}"` : 'Sent an enquiry'
    }
    case 'return_visit':
      return 'Came back to your site'
    case 'page_view': {
      const title = typeof p.title === 'string' ? p.title : null
      const pct   = event.scroll_pct
      if (pct !== undefined && pct >= 75) return title ? `Sat with your content — "${title}"` : 'Sat with your content'
      if (pct !== undefined && pct >= 40) return title ? `Spent time on your site — "${title}"` : 'Spent time on your site'
      return title ? `Browsed your site — "${title}"` : 'Browsed your site'
    }
    default:
      return event.event_type.replace(/_/g, ' ')
  }
}

function eventIcon(event: MergedEvent) {
  switch (event.event_type) {
    case 'property_view': return <Home style={{ width: '12px', height: '12px' }} />
    case 'form_submit':   return <FileText style={{ width: '12px', height: '12px' }} />
    case 'return_visit':  return <RotateCcw style={{ width: '12px', height: '12px' }} />
    case 'page_view':
      return event.scroll_pct !== undefined && event.scroll_pct >= 40
        ? <BookOpen style={{ width: '12px', height: '12px' }} />
        : <Eye style={{ width: '12px', height: '12px' }} />
    default:
      return <Eye style={{ width: '12px', height: '12px' }} />
  }
}

function eventColor(event: MergedEvent): string {
  if (event.event_type === 'form_submit')  return '#C4622D'
  if (event.event_type === 'return_visit') return '#3D5246'
  return '#8C7B6B'
}

// ── Inline editable field ─────────────────────────────────────────────────────

function EditableField({
  contactId, field, value, label, icon, placeholder,
}: {
  contactId: string
  field: string
  value: string | null
  label: string
  icon: React.ReactNode
  placeholder: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value ?? '')
  const [current, setCurrent] = useState(value ?? '')
  const [saving,  setSaving]  = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) ref.current?.focus() }, [editing])

  async function save() {
    if (draft === current) { setEditing(false); return }
    setSaving(true)
    try {
      await fetch(`/api/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: draft.trim() || null }),
      })
      setCurrent(draft.trim())
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  function cancel() { setDraft(current); setEditing(false) }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter')  save()
    if (e.key === 'Escape') cancel()
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0', borderBottom: '1px solid rgba(140,123,107,0.08)' }}>
      <div style={{ color: '#8C7B6B', flexShrink: 0, width: '14px', display: 'flex', alignItems: 'center' }}>
        {icon}
      </div>
      <span style={{ fontSize: '11px', color: '#8C7B6B', width: '60px', flexShrink: 0, fontWeight: 500 }}>{label}</span>
      {editing ? (
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: '6px', minWidth: 0 }}>
          <input
            ref={ref}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKey}
            placeholder={placeholder}
            style={{
              flex: 1, fontSize: '13px', color: '#1A1612',
              background: 'rgba(196,98,45,0.05)',
              border: '1px solid rgba(196,98,45,0.3)',
              borderRadius: '5px', padding: '3px 7px',
              outline: 'none', minWidth: 0,
            }}
          />
          <button onClick={save} disabled={saving}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: '#3D5246', lineHeight: 0, flexShrink: 0 }}>
            <Check style={{ width: '13px', height: '13px' }} />
          </button>
          <button onClick={cancel}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: '#8C7B6B', lineHeight: 0, flexShrink: 0 }}>
            <X style={{ width: '13px', height: '13px' }} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => { setDraft(current); setEditing(true) }}
          style={{
            flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0,
          }}
          className="editable-field-btn"
        >
          <span style={{ fontSize: '13px', color: current ? '#1A1612' : '#8C7B6B', fontStyle: current ? 'normal' : 'italic', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {current || placeholder}
          </span>
          <Pencil style={{ width: '11px', height: '11px', color: '#8C7B6B', flexShrink: 0, opacity: 0 }} className="field-pencil" />
        </button>
      )}
    </div>
  )
}

// ── ContactDrawer ─────────────────────────────────────────────────────────────

// Subset of fields available immediately from the list (before detail loads)
export interface DrawerContact {
  id: string
  first_name:       string | null
  last_name:        string | null
  email:            string | null
  phone:            string | null
  score:            number
  last_seen_at:     string | null
  property_address: string | null
  suburb:           string | null
  crm_source:       string | null
}

interface Props {
  contactId:  string
  preview:    DrawerContact   // data we already have from the list
  onClose:    () => void
  onPrev?:    () => void
  onNext?:    () => void
  hasPrev?:   boolean
  hasNext?:   boolean
}

type DetailData = {
  contact:      DrawerContact
  events:       RawEvent[]
  scoreHistory: { id: string; delta: number; reason: string; score_after: number; occurred_at: string }[]
}

export function ContactDrawer({ contactId, preview, onClose, onPrev, onNext, hasPrev, hasNext }: Props) {
  const [detail, setDetail] = useState<DetailData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setDetail(null)
    fetch(`/api/contacts/${contactId}`)
      .then(r => r.json())
      .then(d => {
        // Only set detail if we got a valid response shape
        if (d && d.contact && Array.isArray(d.events)) {
          setDetail(d)
        }
      })
      .catch(() => { /* silently fall back to preview data */ })
      .finally(() => setLoading(false))
  }, [contactId])

  const contact: DrawerContact = detail?.contact ?? preview
  const events  = Array.isArray(detail?.events) ? mergeScrollDepth(detail!.events) : []

  const name    = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—'
  const initials = ((contact.first_name?.[0] ?? '') + (contact.last_name?.[0] ?? '')).toUpperCase() || (contact.email?.[0]?.toUpperCase() ?? '?')
  const intent  = getIntent(contact.score)

  return (
    <>
      {/* Backdrop (mobile) */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(26,22,18,0.25)',
          zIndex: 40,
          display: 'none',
        }}
        className="drawer-backdrop"
      />

      {/* Panel */}
      <aside style={{
        width: '380px',
        minWidth: '380px',
        height: '100%',
        background: '#FAF7F2',
        borderLeft: '1px solid rgba(140,123,107,0.2)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
      }}>

        {/* Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid rgba(140,123,107,0.12)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            <button onClick={onClose} title="Close"
              style={{ width: '28px', height: '28px', borderRadius: '5px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8C7B6B' }}
              className="dt-btn">
              <X style={{ width: '14px', height: '14px' }} />
            </button>
            <div style={{ width: '1px', height: '16px', background: 'rgba(140,123,107,0.2)', margin: '0 4px' }} />
            <button onClick={onPrev} disabled={!hasPrev} title="Previous"
              style={{ width: '28px', height: '28px', borderRadius: '5px', background: 'none', border: 'none', cursor: hasPrev ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', color: hasPrev ? '#8C7B6B' : 'rgba(140,123,107,0.3)' }}
              className="dt-btn">
              <ChevronUp style={{ width: '14px', height: '14px' }} />
            </button>
            <button onClick={onNext} disabled={!hasNext} title="Next"
              style={{ width: '28px', height: '28px', borderRadius: '5px', background: 'none', border: 'none', cursor: hasNext ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', color: hasNext ? '#8C7B6B' : 'rgba(140,123,107,0.3)' }}
              className="dt-btn">
              <ChevronDown style={{ width: '14px', height: '14px' }} />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>

          {/* Hero */}
          <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid rgba(140,123,107,0.12)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <div style={{
                width: '44px', height: '44px', borderRadius: '50%', flexShrink: 0,
                background: INTENT_BG[intent], color: INTENT_FG[intent],
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '14px', fontWeight: 700, fontFamily: 'var(--font-display)',
              }}>
                {initials.slice(0, 2)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#1A1612', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em', marginBottom: '4px' }}>
                  {name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    padding: '2px 8px', borderRadius: '4px',
                    background: INTENT_BG[intent], color: INTENT_FG[intent],
                    fontSize: '11px', fontWeight: 600,
                  }}>
                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: INTENT_DOT[intent], display: 'inline-block' }} />
                    {INTENT_LABEL[intent]}
                  </span>
                  {contact.suburb && (
                    <span style={{ fontSize: '12px', color: '#8C7B6B' }}>
                      {contact.suburb}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '8px' }}>
              {contact.phone && (
                <a
                  href={`tel:${contact.phone}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    padding: '7px 14px', borderRadius: '7px',
                    background: '#1A1612', color: '#FAF7F2',
                    fontSize: '13px', fontWeight: 500,
                    textDecoration: 'none', flexShrink: 0,
                  }}
                >
                  <Phone style={{ width: '13px', height: '13px' }} />
                  Call
                </a>
              )}
              {contact.email && (
                <a
                  href={`mailto:${contact.email}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    padding: '7px 14px', borderRadius: '7px',
                    background: 'transparent', color: '#1A1612',
                    border: '1px solid rgba(140,123,107,0.35)',
                    fontSize: '13px', fontWeight: 500,
                    textDecoration: 'none', flexShrink: 0,
                  }}
                >
                  <Mail style={{ width: '13px', height: '13px' }} />
                  Email
                </a>
              )}
            </div>
          </div>

          {/* About — editable fields */}
          <div style={{ padding: '14px 20px 2px', borderBottom: '1px solid rgba(140,123,107,0.12)' }}>
            <p style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8C7B6B', marginBottom: '8px' }}>
              About
            </p>
            <EditableField contactId={contact.id} field="phone"            value={contact.phone}            label="Phone"   icon={<Phone   style={{ width: '13px', height: '13px' }} />} placeholder="Add phone number" />
            <EditableField contactId={contact.id} field="email"            value={contact.email}            label="Email"   icon={<Mail    style={{ width: '13px', height: '13px' }} />} placeholder="Add email address" />
            <EditableField contactId={contact.id} field="suburb"           value={contact.suburb}           label="Suburb"  icon={<MapPin  style={{ width: '13px', height: '13px' }} />} placeholder="Add suburb" />
            <EditableField contactId={contact.id} field="property_address" value={contact.property_address} label="Address" icon={<Home    style={{ width: '13px', height: '13px' }} />} placeholder="Add property address" />
            <div style={{ paddingBottom: '12px' }} />
          </div>

          {/* Activity timeline */}
          <div style={{ padding: '14px 20px 20px' }}>
            <p style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8C7B6B', marginBottom: '12px' }}>
              Activity
            </p>

            {loading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[1, 2, 3].map(i => (
                  <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'rgba(140,123,107,0.1)', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ height: '12px', borderRadius: '3px', background: 'rgba(140,123,107,0.1)', width: '70%', marginBottom: '4px' }} />
                      <div style={{ height: '10px', borderRadius: '3px', background: 'rgba(140,123,107,0.07)', width: '35%' }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && events.length === 0 && (
              <p style={{ fontSize: '13px', color: '#8C7B6B', fontStyle: 'italic' }}>
                No activity recorded yet.
              </p>
            )}

            {!loading && events.map((event, i) => {
              const isForm   = event.event_type === 'form_submit'
              const isReturn = event.event_type === 'return_visit'
              const color    = eventColor(event)

              return (
                <div key={event.event_id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: i < events.length - 1 ? '14px' : 0 }}>
                  {/* Rail */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, position: 'relative' }}>
                    <div style={{
                      width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: isForm ? 'rgba(196,98,45,0.1)' : isReturn ? 'rgba(61,82,70,0.1)' : 'rgba(140,123,107,0.08)',
                      color,
                    }}>
                      {eventIcon(event)}
                    </div>
                    {i < events.length - 1 && (
                      <div style={{ width: '1px', flex: 1, background: 'rgba(140,123,107,0.12)', minHeight: '14px', marginTop: '3px' }} />
                    )}
                  </div>

                  {/* Label */}
                  <div style={{ flex: 1, paddingBottom: '0' }}>
                    <div style={{
                      fontSize: '12.5px', color,
                      fontWeight: isForm ? 600 : 400,
                      lineHeight: 1.4,
                    }}>
                      {eventLabel(event)}
                    </div>
                    <div style={{ fontSize: '11px', color: '#8C7B6B', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                      {formatDistanceToNow(new Date(event.occurred_at), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid rgba(140,123,107,0.1)',
          flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '10px', fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(140,123,107,0.4)' }}>
            Seize the moment — Horace
          </span>
          <span style={{ fontSize: '11px', color: '#8C7B6B', fontFamily: 'var(--font-mono)' }}>
            {contact.score} pts
          </span>
        </div>
      </aside>
    </>
  )
}
