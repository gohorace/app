'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check, Loader2, Search, UserCog, X } from 'lucide-react'

export interface ReassignAgentOption {
  id: string
  name: string
  /** 'admin' | 'manager' | 'agent' — shown as a quiet role hint. */
  role: string
  /** True for the agent who currently holds the listing (excluded as a target). */
  isCurrent: boolean
}

interface PropertyReassignDialogProps {
  propertyId: string
  propertyAddress: string
  currentAgentName: string | null
  agents: ReassignAgentOption[]
  onClose: () => void
}

/**
 * HOR-379 — reassign a property (and its signals, resident contacts, and
 * in-flight comms) to another agent. Admin/Manager-only affordance; the route
 * enforces the `assign_properties` capability. Mirrors AttachContactDialog's
 * overlay idiom so the property surface stays visually consistent.
 */
export function PropertyReassignDialog({
  propertyId,
  propertyAddress,
  currentAgentName,
  agents,
  onClose,
}: PropertyReassignDialogProps) {
  const router = useRouter()
  const [toAgentId, setToAgentId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Can only move TO someone who isn't already the holder.
  const targets = useMemo(() => agents.filter((a) => !a.isCurrent), [agents])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return targets
    return targets.filter((a) => a.name.toLowerCase().includes(q))
  }, [targets, search])

  async function handleSubmit() {
    if (!toAgentId || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/properties/${propertyId}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_agent_id: toAgentId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(messageFor(data?.error))
        setSaving(false)
        return
      }
      router.refresh()
      onClose()
    } catch {
      setError('Couldn’t reach the server — check your connection.')
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div style={modalStyle}>
        <header style={headerStyle}>
          <div>
            <div style={eyebrowStyle}>Reassign property</div>
            <div className="font-display" style={titleStyle}>
              Hand {propertyAddress} to another agent
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={closeBtnStyle}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </header>

        <div style={bodyStyle}>
          <p style={explainStyle}>
            Moves the property, its signals, its resident contacts, and any scheduled
            emails to the new agent. {currentAgentName ? <>Currently held by <strong style={{ fontWeight: 600, color: '#2E2823' }}>{currentAgentName}</strong>. </> : null}
            Scheduled emails are <strong style={{ fontWeight: 600, color: '#2E2823' }}>paused as drafts</strong> for the new agent
            to review — never sent under their name automatically, never cancelled.
          </p>

          {targets.length > 8 && (
            <div style={searchWrapStyle}>
              <Search style={{ width: 14, height: 14, color: '#8C7B6B' }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search agents by name…"
                style={searchInputStyle}
              />
            </div>
          )}

          {filtered.length === 0 ? (
            <div style={emptyStyle}>
              {search.trim().length > 0
                ? `No agent matches "${search}".`
                : 'No other active agents in this workspace to reassign to.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 300, overflowY: 'auto' }}>
              {filtered.map((a) => {
                const selected = a.id === toAgentId
                return (
                  <button
                    type="button"
                    key={a.id}
                    onClick={() => setToAgentId(a.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 11,
                      padding: '9px 12px',
                      background: '#FFFFFF',
                      border: `1.5px solid ${selected ? '#C4622D' : 'rgba(140,123,107,0.18)'}`,
                      borderRadius: 8,
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'var(--font-body)',
                      transition: 'all 180ms',
                    }}
                  >
                    <span style={agentMarkStyle}>
                      <UserCog style={{ width: 15, height: 15, color: selected ? '#C4622D' : '#8C7B6B' }} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1612', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#8C7B6B', marginTop: 1, textTransform: 'capitalize' }}>{a.role}</div>
                    </div>
                    {selected && <Check style={{ width: 15, height: 15, color: '#C4622D', flexShrink: 0 }} />}
                  </button>
                )
              })}
            </div>
          )}

          {error && (
            <p role="alert" style={errorStyle}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!toAgentId || saving}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 18px',
                borderRadius: 7,
                background: '#1A1612',
                color: '#F5F0E8',
                fontSize: 13,
                fontWeight: 500,
                border: 'none',
                cursor: !toAgentId || saving ? 'not-allowed' : 'pointer',
                opacity: !toAgentId || saving ? 0.5 : 1,
                fontFamily: 'var(--font-body)',
              }}
            >
              {saving ? (
                <>
                  <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" />
                  Reassigning…
                </>
              ) : (
                <>
                  <ArrowRight style={{ width: 13, height: 13 }} />
                  Reassign property
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function messageFor(code: unknown): string {
  switch (code) {
    case 'invalid_target_agent':
      return 'That agent can’t take this property — they may be inactive or in another workspace.'
    case 'property_not_found':
      return 'This property no longer exists.'
    case 'same_agent':
      return 'That agent already holds this property.'
    default:
      return 'Couldn’t reassign — try again.'
  }
}

// ── Styles (mirrors attach-contact-dialog.tsx) ───────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(26,22,18,0.55)',
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: 20,
}

const modalStyle: React.CSSProperties = {
  width: 'min(480px, 100%)',
  maxHeight: '90vh',
  background: '#FAF7F2',
  borderRadius: 12,
  boxShadow: '0 24px 60px rgba(26,22,18,0.32)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '22px 24px 4px',
  gap: 12,
}

const eyebrowStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#8C7B6B',
  marginBottom: 6,
}

const titleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 500,
  color: '#1A1612',
  letterSpacing: '-0.01em',
  lineHeight: 1.25,
}

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: '#8C7B6B',
  padding: 4,
  borderRadius: 4,
  display: 'flex',
  alignSelf: 'flex-start',
}

const bodyStyle: React.CSSProperties = {
  padding: '14px 24px 22px',
  flex: 1,
  overflowY: 'auto',
}

const explainStyle: React.CSSProperties = {
  margin: '0 0 14px',
  fontSize: 12.5,
  lineHeight: 1.55,
  color: '#5E5246',
}

const searchWrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  background: '#FFFFFF',
  border: '1.5px solid rgba(140,123,107,0.3)',
  borderRadius: 8,
  marginBottom: 10,
}

const searchInputStyle: React.CSSProperties = {
  flex: 1,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontSize: 13,
  color: '#1A1612',
  fontFamily: 'var(--font-body)',
}

const agentMarkStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  background: 'rgba(140,123,107,0.12)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
}

const emptyStyle: React.CSSProperties = {
  padding: '14px 16px',
  fontSize: 12,
  color: '#5E5246',
  background: 'rgba(140,123,107,0.06)',
  border: '1px dashed rgba(140,123,107,0.25)',
  borderRadius: 8,
  lineHeight: 1.55,
}

const errorStyle: React.CSSProperties = {
  marginTop: 12,
  padding: '8px 10px',
  background: 'rgba(196,98,45,0.08)',
  border: '1px solid rgba(196,98,45,0.25)',
  borderRadius: 6,
  fontSize: 12,
  color: '#9C4A1F',
}
