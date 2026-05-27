'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Anchor,
  ArrowLeft,
  ArrowRight,
  Database,
  Edit3,
  Eye,
  EyeOff,
  Phone,
  TrendingUp,
  UserPlus,
} from 'lucide-react'
import { AttachContactDialog } from './attach-contact-dialog'
import { NotesThread } from '@/components/notes/notes-thread'
import { useCompanion } from '@/components/companion/companion-context'
import { QuillIcon } from '@/components/ui/quill-icon'
import {
  EngagementIndicator,
  PersonAvatar,
  PropertyThumb,
  RoleBadge,
  StateBadge,
  toneFor,
  type EngagementValue,
  type IdentityState,
  type PropertyStatus,
} from '@/lib/design/badges'

export interface PropertyDetailRoleAttached {
  contactId: string
  name: string
  initials: string
  identity: IdentityState
  role: 'seller' | 'buyer'
  date: string
}

export interface PropertyDetailEngagingNow {
  contactId: string
  name: string
  initials: string
  identity: IdentityState
  lastSeenAt: string | null
  sessions: number
}

export interface PropertyDetailTimelineRow {
  id: string
  kind: 'known' | 'anonymous'
  contactId: string | null
  contactName: string | null
  label: string
  detail: string | null
  occurredAt: string
}

export interface PropertyDetailViewProps {
  property: {
    id:       string
    address:  string
    suburb:   string | null
    status:   PropertyStatus | null
    /** Lat/lng or hero-photo placeholder tone tuple (deterministic from id). */
    firstSeenAt:    string | null
    lastActivityAt: string | null
    notes:          string | null
  }
  knownCount:      number
  anonSessions:    number
  engagement:      EngagementValue
  roleAttached:    PropertyDetailRoleAttached[]
  engagingNow:     PropertyDetailEngagingNow[]
  /** Most active known contact — used by the primary "View most active contact" action. */
  topContact:      { id: string; firstName: string | null } | null
  timeline:        PropertyDetailTimelineRow[]
}

type TimelineFilter = 'all' | 'known' | 'anon'

export function PropertyDetailView({
  property,
  knownCount,
  anonSessions,
  engagement,
  roleAttached,
  engagingNow,
  topContact,
  timeline,
}: PropertyDetailViewProps) {
  const { openCompanion } = useCompanion()
  const [filter, setFilter] = useState<TimelineFilter>('all')
  // HOR-137: Attach contact dialog (mirrors AttachRoleDialog, inverted).
  const [attachOpen, setAttachOpen] = useState(false)
  // HOR-232: optimistic status — ChangeStatusButton updates this instantly on
  // save (rolling back on error), so the badge doesn't wait on a full
  // router.refresh round-trip (~2.5s). Re-sync when the server sends a new
  // property (navigation / external refresh).
  const [status, setStatus] = useState<PropertyStatus | null>(property.status)
  useEffect(() => {
    setStatus(property.status)
  }, [property.id, property.status])

  const tone = toneFor(property.id)
  const filtered = useMemo(() => {
    if (filter === 'all') return timeline
    if (filter === 'known') return timeline.filter((t) => t.kind === 'known')
    return timeline.filter((t) => t.kind === 'anonymous')
  }, [timeline, filter])

  return (
    <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 80 }}>
      <div style={{ maxWidth: 1080, padding: '20px 32px' }}>
        {/* Breadcrumb */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 18,
            fontSize: 13,
          }}
        >
          <Link
            href="/properties"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: '#8C7B6B',
              textDecoration: 'none',
              fontWeight: 500,
              padding: '4px 6px',
              borderRadius: 4,
            }}
          >
            <ArrowLeft style={{ width: 14, height: 14 }} />
            Properties
          </Link>
          <span style={{ color: 'rgba(140,123,107,0.4)' }}>/</span>
          <span style={{ color: '#1A1612', fontWeight: 500 }}>{property.address}</span>
        </div>

        {/* Hero */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(280px, 360px) 1fr',
            gap: 28,
            marginBottom: 22,
          }}
        >
          {/* Photo column */}
          <div>
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: 240,
                borderRadius: 10,
                overflow: 'hidden',
                background: `linear-gradient(135deg, ${tone[0]} 0%, ${tone[1]} 100%)`,
                display: 'flex',
                alignItems: 'flex-end',
                padding: 16,
                boxShadow: 'inset 0 -50px 80px rgba(26,22,18,0.35)',
              }}
            >
              <svg width="100%" height="100%" viewBox="0 0 400 240" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, opacity: 0.18 }} aria-hidden>
                <path d="M0 170 L120 110 L240 150 L320 120 L400 160 L400 240 L0 240 Z" fill="rgba(245,240,232,0.85)" />
                <path d="M0 195 L80 165 L180 185 L280 160 L400 195 L400 240 L0 240 Z" fill="rgba(245,240,232,0.7)" />
              </svg>
              <div
                style={{
                  position: 'relative',
                  zIndex: 1,
                  fontSize: 10,
                  color: 'rgba(245,240,232,0.7)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                Photo from property data source
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: 50,
                    borderRadius: 5,
                    background: `linear-gradient(${135 + i * 30}deg, ${tone[0]} 0%, ${tone[1]} 100%)`,
                    opacity: i === 0 ? 1 : 0.55,
                    border: i === 0 ? '1.5px solid #C4622D' : '1.5px solid transparent',
                  }}
                />
              ))}
            </div>
          </div>

          {/* Info column */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <StateBadge status={status} size="lg" />
              <span style={metaPillStyle}>
                <Database style={{ width: 11, height: 11 }} />
                Read-only · data vendor
              </span>
            </div>

            <h1
              className="font-display"
              style={{
                fontSize: 34,
                fontWeight: 600,
                color: '#1A1612',
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
                margin: '6px 0 4px',
              }}
            >
              {property.address}
            </h1>
            <div style={{ fontSize: 14, color: '#8C7B6B', marginBottom: 20 }}>
              {property.suburb ?? 'Unknown suburb'}
            </div>

            {/* Specs row — placeholders until enrichment lands */}
            <div
              style={{
                display: 'flex',
                border: '1px solid rgba(140,123,107,0.18)',
                borderRadius: 8,
                overflow: 'hidden',
                marginBottom: 20,
                background: '#FAF7F2',
              }}
            >
              <SpecCell label="beds" value="—" />
              <SpecCell label="baths" value="—" />
              <SpecCell label="land" value="—" />
              <SpecCell
                label={
                  status === 'sold'
                    ? 'last sold'
                    : status === 'listed'
                      ? 'asking'
                      : 'last sold'
                }
                value="—"
                last
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {/*
                HOR-135: CRM-boundary language. Horace shows the contact;
                the agent dials from there. Primary action navigates to
                the most active contact's detail page (not a tel: link).
              */}
              {topContact ? (
                <Link
                  href={`/contacts/${topContact.id}`}
                  style={{ ...primaryBtnStyle, textDecoration: 'none' }}
                >
                  <ArrowRight style={{ width: 13, height: 13 }} />
                  View most active contact
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  title="No active contacts on this property yet"
                  style={{ ...primaryBtnStyle, opacity: 0.55, cursor: 'not-allowed' }}
                >
                  <ArrowRight style={{ width: 13, height: 13 }} />
                  View most active contact
                </button>
              )}
              <ChangeStatusButton propertyId={property.id} currentStatus={status} onStatusChange={setStatus} />
              <button
                type="button"
                onClick={() => setAttachOpen(true)}
                style={secondaryBtnStyle}
              >
                <UserPlus style={{ width: 13, height: 13 }} />
                Attach contact
              </button>
            </div>
          </div>
        </div>

        {/* Horace summary line */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 14,
            padding: '16px 20px',
            background: '#2E2823',
            borderRadius: 10,
            marginBottom: 22,
            color: 'rgba(245,240,232,0.92)',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: '#C4622D',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-display)',
              fontSize: 15,
              fontWeight: 600,
              color: '#FAF7F2',
            }}
            aria-hidden
          >
            H
          </div>
          <div style={{ flex: 1, paddingTop: 1 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'rgba(245,240,232,0.42)',
                marginBottom: 5,
              }}
            >
              Inside this property
            </div>
            <div
              style={{
                fontSize: 14,
                lineHeight: 1.6,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <strong>{knownCount}</strong>
              <span>{knownCount === 1 ? 'known contact,' : 'known contacts,'}</span>
              <strong>{anonSessions}</strong>
              <span>{anonSessions === 1 ? 'anonymous session,' : 'anonymous sessions,'}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <EngagementIndicator value={engagement} showLabel />
              </span>
              <span>engagement.</span>
            </div>
          </div>
          {/* HOR-247: Ask Horace on the charcoal strip — opens the companion
              pre-prompted with the address in view. */}
          <button
            type="button"
            onClick={() =>
              openCompanion({
                prompt: `Tell me about ${property.address}`,
                contextLabel: `Property: ${property.address}`,
              })
            }
            style={{
              flexShrink: 0,
              alignSelf: 'center',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 12px',
              background: 'rgba(232,149,109,0.18)',
              color: '#E8956D',
              border: '1px solid rgba(232,149,109,0.35)',
              borderRadius: 7,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
            }}
          >
            <QuillIcon style={{ width: 12, height: 12 }} />
            Ask Horace
          </button>
        </div>

        {/* Notes — HOR-252 threaded NotesThread (replaces the v1 textarea). */}
        <div style={{ marginBottom: 22 }}>
          <NotesThread propertyId={property.id} subjectKind="property" />
        </div>

        {/* Contacts panel */}
        <section style={panelStyle}>
          <PanelHeader
            title="Contacts"
            subtitle="People connected to this property, by role and by recent engagement."
            count={roleAttached.length + engagingNow.length}
          />

          {roleAttached.length === 0 && engagingNow.length === 0 ? (
            <div
              style={{
                padding: '20px 18px',
                background: 'rgba(245,240,232,0.5)',
                border: '1px dashed rgba(140,123,107,0.25)',
                borderRadius: 8,
              }}
            >
              <div style={{ fontSize: 13, color: '#5E5246', marginBottom: 4, fontWeight: 500 }}>
                Nothing stirring on this one yet.
              </div>
              <div style={{ fontSize: 12, color: '#8C7B6B', lineHeight: 1.55 }}>
                Horace is keeping an eye out — you&rsquo;ll hear when someone you know turns up.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {roleAttached.length > 0 && (
                <div>
                  <GroupLabel
                    Icon={Anchor}
                    label="Role-attached"
                    note="durable, survives ownership change"
                  />
                  <div style={contactGridStyle}>
                    {roleAttached.map((r) => (
                      <Link
                        key={r.contactId}
                        href={`/contacts/${r.contactId}`}
                        style={contactCardStyle}
                      >
                        <PersonAvatar initials={r.initials} identity={r.identity} size={36} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1612', marginBottom: 4 }}>
                            {r.name}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <RoleBadge role={r.role} />
                            <span style={{ fontSize: 11, color: '#8C7B6B' }}>· {relativeWhen(r.date)}</span>
                          </div>
                        </div>
                        <ArrowRight style={{ width: 13, height: 13, color: '#5E5246', flexShrink: 0 }} />
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {engagingNow.length > 0 && (
                <div>
                  <GroupLabel
                    Icon={TrendingUp}
                    label="Engaging now"
                    note="this week's behaviour"
                  />
                  <div style={contactGridStyle}>
                    {engagingNow.map((c) => (
                      <Link
                        key={c.contactId}
                        href={`/contacts/${c.contactId}`}
                        style={contactCardStyle}
                      >
                        <PersonAvatar initials={c.initials} identity={c.identity} size={36} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1612', marginBottom: 4 }}>
                            {c.name}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <RoleBadge role="engaged" count={c.sessions > 1 ? c.sessions : undefined} />
                            <span style={{ fontSize: 11, color: '#8C7B6B' }}>
                              · {c.lastSeenAt ? relativeWhen(c.lastSeenAt) : 'recently'}
                            </span>
                          </div>
                        </div>
                        <ArrowRight style={{ width: 13, height: 13, color: '#5E5246', flexShrink: 0 }} />
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Anonymous note */}
          {anonSessions > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                padding: '12px 14px',
                background: 'rgba(46,40,35,0.04)',
                borderRadius: 8,
                alignItems: 'flex-start',
                marginTop: 16,
              }}
            >
              <EyeOff style={{ width: 12, height: 12, color: '#8C7B6B', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 12, color: '#1A1612', fontWeight: 500 }}>
                  Plus {anonSessions} anonymous session{anonSessions === 1 ? '' : 's'} this month.
                </div>
                <div style={{ fontSize: 11, color: '#8C7B6B', marginTop: 2, lineHeight: 1.5 }}>
                  Horace ties anonymous patterns to a contact the moment one comes back as someone you know.
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Behavioural timeline */}
        <section style={panelStyle}>
          <PanelHeader
            title="Behavioural timeline"
            subtitle="Every event on this address, named and anonymous."
            actions={
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <TfBtn label="All"       active={filter === 'all'}   onClick={() => setFilter('all')} />
                <TfBtn label="Known"     active={filter === 'known'} onClick={() => setFilter('known')} />
                <TfBtn label="Anonymous" active={filter === 'anon'}  onClick={() => setFilter('anon')} />
              </div>
            }
          />

          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <p style={{ fontSize: 13, color: '#5E5246', fontWeight: 500, margin: '0 0 4px' }}>
                Quiet so far.
              </p>
              <p style={{ fontSize: 12, color: '#8C7B6B', margin: 0 }}>
                Horace is watching every visit — you&rsquo;ll see them land here.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {filtered.map((row, i) => {
                const isLast = i === filtered.length - 1
                const isKnown = row.kind === 'known'
                const dotColor = isKnown ? '#C4622D' : '#8C7B6B'
                return (
                  <div key={row.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                    <div
                      style={{
                        width: 12,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        flexShrink: 0,
                        paddingTop: 4,
                      }}
                    >
                      <div
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: isKnown ? dotColor : 'transparent',
                          border: isKnown
                            ? `2px solid ${dotColor}`
                            : `2px dashed ${dotColor}`,
                        }}
                      />
                      {!isLast && (
                        <div
                          style={{
                            width: 1,
                            flex: 1,
                            background: 'rgba(140,123,107,0.2)',
                            marginTop: 3,
                            minHeight: 16,
                          }}
                        />
                      )}
                    </div>
                    <div style={{ flex: 1, paddingBottom: 18 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                        {isKnown && row.contactId ? (
                          <Link
                            href={`/contacts/${row.contactId}`}
                            style={{ fontSize: 13, fontWeight: 600, color: '#1A1612', textDecoration: 'none' }}
                          >
                            {row.contactName}
                          </Link>
                        ) : (
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#8C7B6B', fontStyle: 'italic' }}>
                            Anonymous visitor
                          </span>
                        )}
                        <Eye style={{ width: 12, height: 12, color: dotColor }} aria-hidden />
                        <span style={{ fontSize: 13, color: '#2E2823' }}>{row.label}</span>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10,
                            color: '#8C7B6B',
                            marginLeft: 'auto',
                          }}
                        >
                          {relativeWhen(row.occurredAt)}
                        </span>
                      </div>
                      {row.detail && (
                        <div style={{ fontSize: 12, color: '#8C7B6B', lineHeight: 1.5 }}>
                          {row.detail}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <p
          style={{
            marginTop: 12,
            fontSize: 11,
            color: '#8C7B6B',
            fontStyle: 'italic',
          }}
        >
          Your relationships, your history. The property is shared — your view of it is sovereign.
        </p>
      </div>

      {attachOpen && (
        <AttachContactDialog
          propertyId={property.id}
          propertyAddress={property.address}
          onClose={() => setAttachOpen(false)}
        />
      )}
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function PanelHeader({
  title,
  subtitle,
  count,
  actions,
}: {
  title: string
  subtitle: string
  count?: number
  actions?: React.ReactNode
}) {
  return (
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
          {title}
        </h2>
        <p style={{ margin: 0, fontSize: 12, color: '#8C7B6B' }}>{subtitle}</p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {count != null && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: '#8C7B6B',
              background: 'rgba(140,123,107,0.1)',
              padding: '2px 9px',
              borderRadius: 9999,
            }}
          >
            {count}
          </span>
        )}
        {actions}
      </div>
    </div>
  )
}

function GroupLabel({
  Icon,
  label,
  note,
}: {
  Icon: typeof Anchor
  label: string
  note: string
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: '#5E5246',
        marginBottom: 10,
      }}
    >
      <Icon style={{ width: 11, height: 11 }} />
      {label}
      <span
        style={{
          fontSize: 10,
          color: '#8C7B6B',
          textTransform: 'none',
          letterSpacing: 0,
          fontWeight: 400,
          fontStyle: 'italic',
          marginLeft: 4,
        }}
      >
        · {note}
      </span>
    </div>
  )
}

// Notes now render via NotesThread (HOR-252); the old NotesPanel is orphaned
// pending an M12 cleanup sweep.
// so Contact Detail can reuse it.

function ChangeStatusButton({
  propertyId,
  currentStatus,
  onStatusChange,
}: {
  propertyId: string
  currentStatus: PropertyStatus | null
  /** Optimistically set the parent's status; called again to roll back on error. */
  onStatusChange: (next: PropertyStatus | null) => void
}) {
  const [open, setOpen] = useState(false)
  // HOR-232: surface a save failure instead of silently reverting (the PATCH
  // used to be fire-and-forget).
  const [error, setError] = useState<string | null>(null)

  const options: PropertyStatus[] = ['listed', 'appraising', 'watching', 'sold']

  async function set(next: PropertyStatus) {
    if (next === currentStatus) {
      setOpen(false)
      return
    }
    // Optimistic: update the badge instantly and close the menu — no waiting
    // on the PATCH or a full router.refresh. Roll back + surface the error if
    // the server rejects it.
    const prev = currentStatus
    setError(null)
    setOpen(false)
    onStatusChange(next)
    try {
      const res = await fetch(`/api/properties/${propertyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null
        onStatusChange(prev)
        setError(detail?.error ? `Couldn't save — ${detail.error}` : "Couldn't save — try again.")
        setOpen(true)
      }
    } catch {
      onStatusChange(prev)
      setError("Couldn't save — check your connection.")
      setOpen(true)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => {
          setError(null)
          setOpen((o) => !o)
        }}
        style={secondaryBtnStyle}
      >
        <Edit3 style={{ width: 13, height: 13 }} />
        Change state
      </button>
      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 15 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              zIndex: 20,
              background: '#FAF7F2',
              border: '1px solid rgba(140,123,107,0.22)',
              borderRadius: 8,
              boxShadow: '0 12px 32px rgba(26,22,18,0.18)',
              padding: 4,
              minWidth: 160,
            }}
          >
            {options.map((opt) => (
              <div
                key={opt}
                onClick={() => set(opt)}
                style={{
                  padding: '7px 10px',
                  fontSize: 12,
                  color: '#1A1612',
                  cursor: 'pointer',
                  borderRadius: 5,
                  background: currentStatus === opt ? 'rgba(196,98,45,0.08)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <StateBadge status={opt} />
              </div>
            ))}
            {error && (
              <div
                role="alert"
                style={{
                  margin: '4px 6px 2px',
                  padding: '7px 8px',
                  fontSize: 11,
                  lineHeight: 1.4,
                  color: '#9C4A1F',
                  background: 'rgba(196,98,45,0.1)',
                  borderRadius: 5,
                }}
              >
                {error}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function TfBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 10px',
        fontSize: 11,
        fontWeight: 500,
        color: active ? '#1A1612' : '#8C7B6B',
        background: active ? 'rgba(140,123,107,0.12)' : 'transparent',
        border: '1px solid transparent',
        borderRadius: 6,
        cursor: 'pointer',
        fontFamily: 'var(--font-body)',
      }}
    >
      {label}
    </button>
  )
}

function SpecCell({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        padding: '12px 16px',
        borderRight: last ? 'none' : '1px solid rgba(140,123,107,0.14)',
      }}
    >
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500, color: '#1A1612' }}>
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: '#8C7B6B',
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const metaPillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 10,
  fontWeight: 500,
  padding: '3px 8px',
  borderRadius: 9999,
  background: 'rgba(140,123,107,0.1)',
  color: '#8C7B6B',
}

const primaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '9px 14px',
  borderRadius: 7,
  background: '#C4622D',
  color: '#F5F0E8',
  fontSize: 13,
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
  textDecoration: 'none',
}

const secondaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '9px 14px',
  borderRadius: 7,
  background: 'transparent',
  color: '#1A1612',
  fontSize: 13,
  fontWeight: 500,
  border: '1px solid rgba(140,123,107,0.3)',
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
}

const panelStyle: React.CSSProperties = {
  background: '#FAF7F2',
  border: '1px solid rgba(140,123,107,0.18)',
  borderRadius: 10,
  padding: '20px 22px',
  marginBottom: 18,
}

const contactGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 8,
}

const contactCardStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 14px',
  background: '#FFFFFF',
  border: '1px solid rgba(140,123,107,0.18)',
  borderRadius: 8,
  textDecoration: 'none',
  color: 'inherit',
  cursor: 'pointer',
  transition: 'all 180ms',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
