'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Search } from 'lucide-react'
import { ContactDrawer } from './contact-drawer'
import { createClient } from '@/lib/supabase/client'

const ONLINE_MS = 5 * 60 * 1000 // 5 minutes

function isRecentlySeen(ts: string | null): boolean {
  if (!ts) return false
  return Date.now() - new Date(ts).getTime() < ONLINE_MS
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Intent = 'high' | 'mid' | 'low' | 'none'

export type ContactRow = {
  id:               string
  first_name:       string | null
  last_name:        string | null
  email:            string | null
  phone:            string | null
  score:            number
  score_change_7d:  number
  last_seen_at:     string | null
  property_address: string | null
  suburb:           string | null
  crm_source:       string | null
  session_count:    number
  last_event_type:  string | null
  last_page_title:  string | null
}

// ── Intent ────────────────────────────────────────────────────────────────────

function getIntent(score: number): Intent {
  if (score >= 50) return 'high'
  if (score >= 20) return 'mid'
  if (score >= 5)  return 'low'
  return 'none'
}

const INTENT_LABEL: Record<Intent, string> = {
  high: 'High', mid: 'Mid', low: 'Watching', none: 'Quiet',
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

// ── Score trend ───────────────────────────────────────────────────────────────

function TrendBadge({ delta }: { delta: number }) {
  if (delta > 0) return (
    <span style={{ fontSize: '11px', color: '#3D5246', fontFamily: 'var(--font-mono)' }}>↑{delta}</span>
  )
  if (delta < 0) return (
    <span style={{ fontSize: '11px', color: '#8C7B6B', fontFamily: 'var(--font-mono)' }}>↓{Math.abs(delta)}</span>
  )
  return <span style={{ fontSize: '11px', color: 'rgba(140,123,107,0.4)', fontFamily: 'var(--font-mono)' }}>→</span>
}

// ── Last page label ───────────────────────────────────────────────────────────

function lastPageLabel(eventType: string | null, title: string | null): string {
  if (!eventType) return '—'
  if (eventType === 'form_submit') return title ? `Enquiry: ${title}` : 'Submitted an enquiry'
  if (eventType === 'property_view') return title ? title : 'Property listing'
  return title || 'Your site'
}

// ── ContactsGrid ──────────────────────────────────────────────────────────────

interface Props {
  contacts:   ContactRow[]
  initialQ?:  string
  agentId:    string
}

// Flex proportions — columns scale to fill available width.
// sessions and lastSeen have minWidth so they don't collapse on narrow screens.
const COL_FLEX = {
  name:     3,
  email:    2.5,
  suburb:   1.5,
  intent:   1.5,
  lastPage: 2.5,
  sessions: 1,
  lastSeen: 1,
}
const COL_MIN: Partial<Record<keyof typeof COL_FLEX, string>> = {
  name:     '120px',
  email:    '120px',
  sessions: '60px',
  lastSeen: '70px',
}

export function ContactsGrid({ contacts, initialQ = '', agentId }: Props) {
  const [search,     setSearch]     = useState(initialQ)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [onlineIds,  setOnlineIds]  = useState<Set<string>>(() => {
    const safe = Array.isArray(contacts) ? contacts : []
    return new Set(safe.filter(c => isRecentlySeen(c.last_seen_at)).map(c => c.id))
  })
  const latestSeenRef = useRef<Map<string, string>>(new Map(
    (Array.isArray(contacts) ? contacts : []).map(c => [c.id, c.last_seen_at ?? ''])
  ))

  // Supabase Realtime — watch for last_seen_at updates on this agent's contacts
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('contacts-online')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'contacts', filter: `agent_id=eq.${agentId}` },
        (payload) => {
          const row = payload.new as { id: string; last_seen_at: string | null }
          latestSeenRef.current.set(row.id, row.last_seen_at ?? '')
          setOnlineIds(prev => {
            const next = new Set(prev)
            if (isRecentlySeen(row.last_seen_at)) {
              next.add(row.id)
            } else {
              next.delete(row.id)
            }
            return next
          })
        }
      )
      .subscribe()

    // Tick every 60s to expire stale online statuses
    const interval = setInterval(() => {
      setOnlineIds(() => {
        const next = new Set<string>()
        for (const [id, ts] of latestSeenRef.current) {
          if (isRecentlySeen(ts)) next.add(id)
        }
        return next
      })
    }, 60_000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [agentId])

  const safeContacts = Array.isArray(contacts) ? contacts : []

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return safeContacts
    return safeContacts.filter(c =>
      [c.first_name, c.last_name, c.email, c.suburb, c.property_address]
        .join(' ').toLowerCase().includes(q)
    )
  }, [safeContacts, search])

  const selectedIdx  = selectedId ? filtered.findIndex(c => c.id === selectedId) : -1
  const selectedContact = selectedIdx >= 0 ? filtered[selectedIdx] : null

  const handleSelect = useCallback((id: string) => {
    setSelectedId(prev => prev === id ? null : id)
  }, [])

  const handlePrev = useCallback(() => {
    if (selectedIdx > 0) setSelectedId(filtered[selectedIdx - 1].id)
  }, [selectedIdx, filtered])

  const handleNext = useCallback(() => {
    if (selectedIdx < filtered.length - 1) setSelectedId(filtered[selectedIdx + 1].id)
  }, [selectedIdx, filtered])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Page header */}
      <div style={{
        padding: '16px 24px 12px',
        borderBottom: '1px solid rgba(140,123,107,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, background: '#F5F0E8',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 600, color: '#1A1612', fontFamily: 'var(--font-display)', letterSpacing: '-0.015em', margin: 0 }}>
            Contacts
          </h1>
          <span style={{ fontSize: '12px', color: '#8C7B6B', background: 'rgba(140,123,107,0.1)', padding: '2px 8px', borderRadius: '4px', fontFamily: 'var(--font-mono)' }}>
            {filtered.length}
          </span>
        </div>

        {/* Search */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '5px 10px',
          background: 'rgba(140,123,107,0.08)',
          border: '1px solid transparent',
          borderRadius: '6px', width: '220px',
        }}
          className="contacts-search"
        >
          <Search style={{ width: '13px', height: '13px', color: '#8C7B6B', flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search contacts…"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontFamily: 'var(--font-body)', fontSize: '13px', color: '#1A1612',
              minWidth: 0,
            }}
          />
        </div>
      </div>

      {/* Main area: grid + optional drawer */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Grid */}
        <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
          <div style={{ width: '100%' }}>

            {/* Column headers */}
            <div style={{
              display: 'flex', alignItems: 'center',
              padding: '0 16px',
              height: '36px',
              background: '#FAF7F2',
              borderBottom: '1px solid rgba(140,123,107,0.15)',
              position: 'sticky', top: 0, zIndex: 2,
            }}>
              {[
                { label: 'Name',      key: 'name'     as const },
                { label: 'Email',     key: 'email'    as const },
                { label: 'Suburb',    key: 'suburb'   as const },
                { label: 'Signal',    key: 'intent'   as const },
                { label: 'Last page', key: 'lastPage' as const },
                { label: 'Sessions',  key: 'sessions' as const },
                { label: 'Last seen', key: 'lastSeen' as const },
              ].map(col => (
                <div key={col.label} style={{
                  flex: COL_FLEX[col.key],
                  minWidth: COL_MIN[col.key] ?? 0,
                  fontSize: '10px', fontWeight: 600,
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: '#8C7B6B',
                  fontFamily: col.mono ? 'var(--font-mono)' : 'var(--font-body)',
                  paddingRight: '12px',
                  display: 'flex', alignItems: 'center',
                  overflow: 'hidden',
                }}>
                  {col.label}
                </div>
              ))}
            </div>

            {/* Empty states */}
            {filtered.length === 0 && (
              <div style={{ padding: '64px 24px', textAlign: 'center' }}>
                <p style={{ fontSize: '14px', fontWeight: 500, color: '#1A1612', marginBottom: '6px' }}>
                  {search
                    ? `No contacts match "${search}"`
                    : safeContacts.length === 0
                      ? "Horace hasn't met anyone yet."
                      : 'No contacts found.'}
                </p>
                {!search && safeContacts.length === 0 && (
                  <p style={{ fontSize: '13px', color: '#8C7B6B' }}>
                    Import your contacts to get started.
                  </p>
                )}
              </div>
            )}

            {/* Rows */}
            {filtered.map((contact, idx) => {
              const intent    = getIntent(contact.score)
              const name      = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—'
              const initials  = ((contact.first_name?.[0] ?? '') + (contact.last_name?.[0] ?? '')).toUpperCase() || (contact.email?.[0]?.toUpperCase() ?? '?')
              const selected  = contact.id === selectedId
              const isEven    = idx % 2 === 0
              const isOnline  = onlineIds.has(contact.id)

              return (
                <div
                  key={contact.id}
                  onClick={() => handleSelect(contact.id)}
                  style={{
                    display: 'flex', alignItems: 'center',
                    padding: '0 16px',
                    height: '44px',
                    background: selected
                      ? 'rgba(196,98,45,0.06)'
                      : isEven ? '#FAF7F2' : 'rgba(245,240,232,0.5)',
                    borderBottom: '1px solid rgba(140,123,107,0.08)',
                    cursor: 'pointer',
                    transition: 'background 100ms',
                    outline: selected ? '1px solid rgba(196,98,45,0.2)' : 'none',
                    outlineOffset: '-1px',
                  }}
                  className="grid-row"
                >
                  {/* Name */}
                  <div style={{ flex: COL_FLEX.name, minWidth: COL_MIN.name, display: 'flex', alignItems: 'center', gap: '9px', paddingRight: '12px', overflow: 'hidden' }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{
                        width: '26px', height: '26px', borderRadius: '50%',
                        background: INTENT_BG[intent], color: INTENT_FG[intent],
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '10px', fontWeight: 700,
                      }}>
                        {initials.slice(0, 2)}
                      </div>
                      {isOnline && (
                        <span style={{
                          position: 'absolute', bottom: '0px', right: '0px',
                          width: '8px', height: '8px', borderRadius: '50%',
                          background: '#3DA361',
                          border: '1.5px solid #FAF7F2',
                          animation: 'online-pulse 2s ease-in-out infinite',
                        }} />
                      )}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#1A1612', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}
                      </div>
                      {contact.property_address && (
                        <div style={{ fontSize: '10.5px', color: '#C4622D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '0px' }}>
                          {contact.property_address}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Email */}
                  <div style={{ flex: COL_FLEX.email, minWidth: COL_MIN.email, paddingRight: '12px', overflow: 'hidden' }}>
                    <span style={{ fontSize: '12.5px', color: '#5A4D40', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                      {contact.email ?? '—'}
                    </span>
                  </div>

                  {/* Suburb */}
                  <div style={{ flex: COL_FLEX.suburb, minWidth: 0, paddingRight: '12px', overflow: 'hidden' }}>
                    {contact.suburb ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '2px 8px', borderRadius: '4px',
                        background: 'rgba(140,123,107,0.1)',
                        fontSize: '11.5px', fontWeight: 500, color: '#1A1612',
                        overflow: 'hidden', maxWidth: '100%',
                      }}>
                        {contact.suburb}
                      </span>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'rgba(140,123,107,0.4)' }}>—</span>
                    )}
                  </div>

                  {/* Intent */}
                  <div style={{ flex: COL_FLEX.intent, minWidth: 0, paddingRight: '12px', display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '5px',
                      padding: '2px 8px', borderRadius: '4px',
                      background: INTENT_BG[intent], color: INTENT_FG[intent],
                      fontSize: '11.5px', fontWeight: 500,
                    }}>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: INTENT_DOT[intent], display: 'inline-block', flexShrink: 0 }} />
                      {INTENT_LABEL[intent]}
                    </span>
                    <TrendBadge delta={contact.score_change_7d} />
                  </div>

                  {/* Last page */}
                  <div style={{ flex: COL_FLEX.lastPage, minWidth: 0, paddingRight: '12px', overflow: 'hidden' }}>
                    <span style={{ fontSize: '12.5px', color: contact.last_event_type ? '#1A1612' : 'rgba(140,123,107,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                      {lastPageLabel(contact.last_event_type, contact.last_page_title)}
                    </span>
                  </div>

                  {/* Sessions */}
                  <div style={{ flex: COL_FLEX.sessions, minWidth: COL_MIN.sessions, paddingRight: '12px' }}>
                    <span style={{ fontSize: '12.5px', color: contact.session_count > 0 ? '#1A1612' : 'rgba(140,123,107,0.4)', fontFamily: 'var(--font-mono)' }}>
                      {contact.session_count > 0 ? contact.session_count : '—'}
                    </span>
                  </div>

                  {/* Last seen */}
                  <div style={{ flex: COL_FLEX.lastSeen, minWidth: COL_MIN.lastSeen }}>
                    <span style={{ fontSize: '12px', color: '#8C7B6B', fontFamily: 'var(--font-mono)' }}>
                      {contact.last_seen_at
                        ? formatDistanceToNow(new Date(contact.last_seen_at), { addSuffix: false })
                        : '—'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Drawer */}
        {selectedContact && (
          <ContactDrawer
            key={selectedContact.id}
            contactId={selectedContact.id}
            preview={selectedContact}
            isOnline={onlineIds.has(selectedContact.id)}
            onClose={() => setSelectedId(null)}
            onPrev={handlePrev}
            onNext={handleNext}
            hasPrev={selectedIdx > 0}
            hasNext={selectedIdx < filtered.length - 1}
          />
        )}
      </div>

      {/* Footer count */}
      <div style={{
        padding: '7px 20px',
        borderTop: '1px solid rgba(140,123,107,0.1)',
        flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: '11px', color: '#8C7B6B' }}>
          {search
            ? `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`
            : `${safeContacts.length} contact${safeContacts.length !== 1 ? 's' : ''}`}
        </span>
      </div>
    </div>
  )
}
