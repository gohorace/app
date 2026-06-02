'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Anchor,
  Bell,
  Database,
  Eye,
  EyeOff,
  Feather,
  Flame,
  MapPin,
  MoreHorizontal,
  Pencil,
  Repeat,
  Sun,
  TrendingUp,
  UserPlus,
  UserCog,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import {
  StateBadge,
  IdentityGradient,
  RoleBadge,
  EngagementIndicator,
  PersonAvatar,
  STATE_STYLE,
  type PropertyStatus,
  type IdentityState,
} from '@/lib/design/badges'
import {
  tierFor,
  type PropertySignal,
  type CirclingContact,
  type PropertyTimelineRow,
  type ChangeChipIcon,
} from '@/lib/properties/signal'
import type { PropertyRead } from '@/lib/ai/property-read'
import { useCompanion } from '@/components/companion/companion-context'
import { AttachContactDialog } from './attach-contact-dialog'
import { PropertyReassignDialog, type ReassignAgentOption } from './property-reassign-dialog'
import { PropertyTrail } from './property-trail'

// Role-attached vendors/buyers (durable metadata roles) — derived by the page.
export interface PropertyDetailRoleAttached {
  contactId: string
  name: string
  initials: string
  identity: IdentityState
  role: 'seller' | 'buyer' | 'landlord'
  date: string
}

export interface PropertyDetailViewProps {
  property: {
    id: string
    address: string
    suburb: string | null
    status: PropertyStatus
  }
  /** PR1 behavioural derivation — circling, timeline, chips, anon sessions. */
  signal: PropertySignal
  /** PR2 "Horace's read" — read + provenance + freshness. */
  read: PropertyRead
  /** Durable seller/buyer roles on this property (metadata). */
  roleAttached: PropertyDetailRoleAttached[]
  /**
   * HOR-379 — reassignment affordance. Present (Admin/Manager only) when the
   * viewer can `assign_properties`; omitted otherwise so Agents never see it.
   */
  reassign?: {
    currentAgentName: string | null
    agents: ReassignAgentOption[]
  }
}

type TimelineFilter = 'all' | 'known' | 'moments' | 'anon'

// ── Mobile breakpoint ─────────────────────────────────────────────────────────
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return isMobile
}

const CHIP_ICON: Record<ChangeChipIcon, LucideIcon> = {
  flame: Flame,
  repeat: Repeat,
  'eye-off': EyeOff,
}

export function PropertyDetailView({ property, signal, read, roleAttached, reassign }: PropertyDetailViewProps) {
  const { openCompanion } = useCompanion()
  const isMobile = useIsMobile()
  const [status, setStatus] = useState<PropertyStatus>(property.status)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>('all')
  const [attachOpen, setAttachOpen] = useState(false)
  const [reassignOpen, setReassignOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => setStatus(property.status), [property.id, property.status])

  const hottest = signal.circling[0] ?? null
  const shortAddr = useMemo(() => {
    const i = property.address.indexOf(',')
    return i === -1 ? property.address : property.address.slice(0, i).trim()
  }, [property.address])

  function openCompanionForProperty(prompt: string) {
    openCompanion({ prompt, contextLabel: `Property: ${property.address}` })
  }
  const askFollowUp = () => openCompanionForProperty(`Tell me about ${property.address}`)
  const draftOutreach = () =>
    openCompanionForProperty(
      hottest ? `Draft outreach to ${hottest.name} about ${property.address}` : `Tell me about ${property.address}`,
    )

  async function changeStatus(next: PropertyStatus) {
    if (next === status) return
    const prev = status
    setStatus(next) // optimistic
    setStatusError(null)
    setSheetOpen(false)
    try {
      const res = await fetch(`/api/properties/${property.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) {
        setStatus(prev)
        setStatusError('Couldn’t save — try again.')
      }
    } catch {
      setStatus(prev)
      setStatusError('Couldn’t save — check your connection.')
    }
  }

  const filteredTimeline = useMemo(() => {
    if (timelineFilter === 'all') return signal.timeline
    if (timelineFilter === 'known') return signal.timeline.filter((r) => r.kind === 'known')
    if (timelineFilter === 'moments') return signal.timeline.filter((r) => r.kind === 'moment')
    return signal.timeline.filter((r) => r.kind === 'anon')
  }, [signal.timeline, timelineFilter])

  // Engaging-now (CONTEXT) = circling contacts not already role-attached.
  const roleAttachedIds = useMemo(() => new Set(roleAttached.map((r) => r.contactId)), [roleAttached])
  const engagingNow = useMemo(
    () => signal.circling.filter((c) => !roleAttachedIds.has(c.contactId)),
    [signal.circling, roleAttachedIds],
  )

  return (
    <div style={{ flex: 1, overflowY: 'auto', position: 'relative', paddingBottom: isMobile ? 132 : 80 }}>
      <div style={{ maxWidth: 880, padding: isMobile ? '16px 16px 16px' : '28px 36px 56px' }}>
        {/* Header */}
        {isMobile ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Link href="/properties" aria-label="Back to properties" style={iconBtnStyle}>
              <ArrowLeft style={{ width: 17, height: 17, color: '#1A1612' }} />
            </Link>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1612', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {shortAddr}
            </span>
            <Link href="/digest" aria-label="Stream" style={iconBtnStyle}>
              <Bell style={{ width: 17, height: 17, color: '#8C7B6B' }} />
            </Link>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22, fontSize: 13 }}>
            <Link href="/properties" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#8C7B6B', textDecoration: 'none', fontWeight: 500, padding: '4px 6px', borderRadius: 4 }}>
              <ArrowLeft style={{ width: 14, height: 14 }} />
              Properties
            </Link>
            <span style={{ color: 'rgba(140,123,107,0.4)' }}>/</span>
            <span style={{ color: '#1A1612', fontWeight: 500 }}>{shortAddr}</span>
          </div>
        )}

        {/* ── IDENTITY (text-led, no photo) ───────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <StateBadge status={status} size="lg" />
          <span style={metaPillStyle}>
            <Database style={{ width: 11, height: 11 }} />
            Read-only · data vendor
          </span>
        </div>
        <h1
          className="font-display"
          style={{ fontWeight: 600, color: '#1A1612', letterSpacing: '-0.02em', lineHeight: 1.1, margin: '0 0 4px', fontSize: isMobile ? 27 : 34 }}
        >
          {shortAddr}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: '#8C7B6B' }}>
          <MapPin style={{ width: 13, height: 13 }} />
          {property.suburb ?? 'Suburb pending'}
        </div>

        {/* ── Reassignment (Admin/Manager only — HOR-379) ─────────────────── */}
        {reassign && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <span style={metaPillStyle}>
              <UserCog style={{ width: 11, height: 11 }} />
              {reassign.currentAgentName ? `Assigned to ${reassign.currentAgentName}` : 'Unassigned'}
            </span>
            <button type="button" onClick={() => setReassignOpen(true)} style={ghostBtnStyle}>
              <UserCog style={{ width: 13, height: 13 }} /> Reassign
            </button>
          </div>
        )}

        {/* ── SIGNAL ──────────────────────────────────────────────────────── */}
        <ActStart label="Why now" tone="signal" />

        {/* a) Horace's read card */}
        <div style={readCardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 11, flexWrap: 'wrap' }}>
            <HoraceMark />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1A1612' }}>Horace&rsquo;s read</span>
            <span style={autoPillStyle}>
              <Zap style={{ width: 10, height: 10 }} /> Auto · from your data
            </span>
            {read.updatedAt && (
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: '#8C7B6B' }}>
                updated {relativeWhen(read.updatedAt)}
              </span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: '#2E2823', textWrap: 'pretty' }}>{read.read}</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(140,123,107,0.14)', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#8C7B6B' }}>
              <TrendingUp style={{ width: 11, height: 11 }} /> {read.provenance}
            </span>
            <button type="button" onClick={askFollowUp} style={textBtnStyle}>
              <Feather style={{ width: 12, height: 12 }} /> Ask a follow-up
            </button>
          </div>
        </div>

        {/* b) Change chips */}
        {signal.changeChips.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
            {signal.changeChips.map((c, i) => {
              const Icon = CHIP_ICON[c.icon]
              return (
                <span key={i} style={chipStyle}>
                  <Icon style={{ width: 12, height: 12, color: '#C4622D' }} />
                  {c.label}
                </span>
              )
            })}
          </div>
        )}

        {/* c) Circling now */}
        {(signal.circling.length > 0 || signal.anonSessions > 0) && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={groupLabelStyle}>Circling now</span>
              <EngagementIndicator value={signal.engagement} showLabel />
              <span style={{ fontSize: 11.5, color: '#8C7B6B' }}>
                · borrowed from {signal.knownCount} known contact{signal.knownCount === 1 ? '' : 's'}
                {signal.anonSessions > 0 ? ` + ${signal.anonSessions} anonymous` : ''}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {signal.circling.map((c, i) => (
                <CirclingPersonCard key={c.contactId} contact={c} hottest={i === 0} />
              ))}
            </div>
            {signal.anonSessions > 0 && (
              <div style={anonNoteStyle}>
                <EyeOff style={{ width: 14, height: 14, color: '#8C7B6B', flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: 12.5, color: '#5E5246', lineHeight: 1.5 }}>
                  <strong style={{ fontWeight: 600 }}>{signal.anonSessions} anonymous session{signal.anonSessions === 1 ? '' : 's'}</strong> this month.
                  Horace ties them to a name the moment one returns as someone you know.
                </span>
              </div>
            )}
          </div>
        )}

        {/* d) Surfaced in Stream — links to the feed; per-card permalink (/stream/[id]) is the PR3 follow-up */}
        {read.updatedAt && (
          <Link href="/digest" style={streamLinkStyle}>
            <Sun style={{ width: 13, height: 13, color: '#C4622D' }} />
            Surfaced in your Stream · {relativeWhen(read.updatedAt)}
            <ArrowUpRight style={{ width: 12, height: 12, color: '#8C7B6B' }} />
          </Link>
        )}

        {/* ── ACTION ──────────────────────────────────────────────────────── */}
        <ActStart label="Horace’s move" tone="action" />
        <div style={recCardStyle}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexDirection: isMobile ? 'column' : 'row' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="font-display" style={{ fontSize: isMobile ? 17 : 18.5, fontWeight: 600, color: '#1A1612', marginBottom: 4 }}>
                {hottest ? `Open ${hottest.firstName} — they’re circling hardest` : 'No one’s circling yet'}
              </div>
              <p style={{ margin: 0, fontSize: 13, color: '#5E5246', lineHeight: 1.5, textWrap: 'pretty' }}>
                {hottest
                  ? `${hottest.firstName} is why this address is warm — ${hottest.read.toLowerCase()}. Open them now, or let Horace draft the outreach in your voice.`
                  : 'Horace will surface the person to open the moment someone starts circling this address.'}
              </p>
            </div>
            {hottest && !isMobile && (
              <Link href={`/contacts/${hottest.contactId}`} style={primaryBtnStyle}>
                Open {hottest.firstName}
                <ArrowRight style={{ width: 15, height: 15 }} />
              </Link>
            )}
          </div>
        </div>
        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#8C7B6B', marginRight: 2 }}>or</span>
            <button type="button" onClick={draftOutreach} style={ghostBtnStyle}>
              <Feather style={{ width: 13, height: 13 }} /> Draft outreach with Horace
            </button>
            {signal.circling.length > 0 && (
              <a href="#circling" style={ghostBtnStyle}>
                <Users style={{ width: 13, height: 13 }} /> View all circling contacts
              </a>
            )}
          </div>
        )}

        {/* ── CONTEXT ─────────────────────────────────────────────────────── */}
        <ActStart label="Context" tone="context" />

        {/* a) State control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
          <span style={{ fontSize: 13, color: '#5E5246', fontWeight: 500 }}>How are you tracking this?</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {STATUS_ORDER.map((s) => (
              <StatePill key={s} status={s} active={status === s} onClick={() => changeStatus(s)} />
            ))}
          </div>
          <span style={{ fontSize: 11.5, color: '#8C7B6B', fontStyle: 'italic' }}>it sharpens what their behaviour means</span>
        </div>
        {statusError && <p style={{ margin: '-12px 0 16px', fontSize: 12, color: '#9C4A1F' }}>{statusError}</p>}

        {/* b) People circling this property */}
        <section id="circling" style={panelStyle}>
          <PanelHeader
            title="People circling this property"
            subtitle="Connected by recent behaviour and by role — one tap to the person."
            count={roleAttached.length + engagingNow.length}
            actions={
              <button type="button" onClick={() => setAttachOpen(true)} style={ghostBtnStyle}>
                <UserPlus style={{ width: 13, height: 13 }} /> Attach contact
              </button>
            }
          />
          {roleAttached.length === 0 && engagingNow.length === 0 ? (
            <p style={{ fontSize: 13, color: '#5E5246', lineHeight: 1.55, margin: 0 }}>
              No vendor attached yet. If {hottest?.firstName ?? 'someone'} is the one, attach them as a prospective vendor — it sharpens every read from here.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {roleAttached.length > 0 && (
                <div>
                  <GroupLabel Icon={Anchor} label="Role-attached" note="durable, survives ownership change" />
                  <div style={gridStyle(isMobile)}>
                    {roleAttached.map((r) => (
                      <RoleAttachedCard key={r.contactId} role={r} />
                    ))}
                  </div>
                </div>
              )}
              {engagingNow.length > 0 && (
                <div>
                  <GroupLabel Icon={TrendingUp} label="Engaging now" note="this week’s behaviour" />
                  <div style={gridStyle(isMobile)}>
                    {engagingNow.map((c) => (
                      <EngagingCard key={c.contactId} contact={c} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* c) Your trail */}
        <section style={panelStyle}>
          <PanelHeader title="Your trail" subtitle="What you’ve noticed on this one — Horace reads it back when something stirs." />
          <PropertyTrail propertyId={property.id} />
        </section>

        {/* d) Behavioural timeline */}
        <section style={panelStyle}>
          <PanelHeader
            title="Behavioural timeline"
            subtitle="Every event on this address — named, anonymous, and the market moments that meet them."
            actions={
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {(['all', 'known', 'moments', 'anon'] as const).map((f) => (
                  <FilterBtn key={f} label={FILTER_LABEL[f]} active={timelineFilter === f} onClick={() => setTimelineFilter(f)} />
                ))}
              </div>
            }
          />
          {filteredTimeline.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <p style={{ fontSize: 13, color: '#5E5246', fontWeight: 500, margin: '0 0 4px' }}>Quiet so far.</p>
              <p style={{ fontSize: 12, color: '#8C7B6B', margin: 0 }}>Horace is watching this address — events land here as they happen.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {filteredTimeline.map((row, i) => (
                <TimelineEntry key={row.id} row={row} isLast={i === filteredTimeline.length - 1} />
              ))}
            </div>
          )}
        </section>

        {/* Sovereignty line */}
        <p style={{ marginTop: 14, fontSize: 11, color: '#8C7B6B', display: 'flex', alignItems: 'center', gap: 6, fontStyle: 'italic' }}>
          <Anchor style={{ width: 12, height: 12 }} />
          The property is shared. Your read of it — the behaviour, the trail, the move — is sovereign, across every tool you ever use.
        </p>
      </div>

      {/* ── Mobile sticky bar + overflow sheet ──────────────────────────── */}
      {isMobile && (
        <>
          {sheetOpen && (
            <div style={sheetStyle}>
              <SheetRow Icon={Feather} label="Draft outreach with Horace" onClick={() => { draftOutreach(); setSheetOpen(false) }} />
              <SheetRow Icon={Pencil} label="Change state" onClick={() => { setSheetOpen(false); document.getElementById('circling')?.scrollIntoView({ behavior: 'smooth' }) }} />
              <SheetRow Icon={UserPlus} label="Attach contact" last onClick={() => { setAttachOpen(true); setSheetOpen(false) }} />
            </div>
          )}
          <div style={stickyBarStyle}>
            {hottest ? (
              <Link href={`/contacts/${hottest.contactId}`} style={{ ...primaryBtnStyle, flex: 1, justifyContent: 'center', padding: '14px 18px', fontSize: 15 }}>
                Open {hottest.firstName}
                <ArrowRight style={{ width: 16, height: 16 }} />
              </Link>
            ) : (
              <button type="button" onClick={draftOutreach} style={{ ...primaryBtnStyle, flex: 1, justifyContent: 'center', padding: '14px 18px', fontSize: 15 }}>
                <Feather style={{ width: 16, height: 16 }} /> Draft with Horace
              </button>
            )}
            <button
              type="button"
              aria-label="More actions"
              onClick={() => setSheetOpen((o) => !o)}
              style={{ width: 50, borderRadius: 9, background: '#FAF7F2', border: '1px solid rgba(140,123,107,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: sheetOpen ? 'inset 0 0 0 1px rgba(196,98,45,0.4)' : 'none' }}
            >
              <MoreHorizontal style={{ width: 20, height: 20, color: sheetOpen ? '#C4622D' : '#8C7B6B' }} />
            </button>
          </div>
        </>
      )}

      {attachOpen && (
        <AttachContactDialog propertyId={property.id} propertyAddress={property.address} onClose={() => setAttachOpen(false)} />
      )}

      {reassignOpen && reassign && (
        <PropertyReassignDialog
          propertyId={property.id}
          propertyAddress={property.address}
          currentAgentName={reassign.currentAgentName}
          agents={reassign.agents}
          onClose={() => setReassignOpen(false)}
        />
      )}
    </div>
  )
}

// ── Act rule (label + hairline) ───────────────────────────────────────────────

function ActStart({ label, tone }: { label: string; tone: 'signal' | 'action' | 'context' }) {
  const quiet = tone === 'context'
  const color = quiet ? '#8C7B6B' : '#C4622D'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 36, marginBottom: 18 }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          fontSize: quiet ? 10 : 11,
          fontWeight: 600,
          letterSpacing: quiet ? '0.14em' : '0.12em',
          textTransform: 'uppercase',
          color,
        }}
      >
        {!quiet && <Zap style={{ width: 13, height: 13 }} />}
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: 'rgba(140,123,107,0.14)' }} />
    </div>
  )
}

function HoraceMark({ size = 22 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: '#C4622D', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} aria-hidden>
      <span className="font-display" style={{ fontWeight: 600, fontSize: size * 0.5, color: '#FAF7F2', lineHeight: 1 }}>H</span>
    </div>
  )
}

// ── Circling person card (SIGNAL — pull bar) ─────────────────────────────────

function CirclingPersonCard({ contact, hottest }: { contact: CirclingContact; hottest: boolean }) {
  const tier = tierFor(contact.pct)
  return (
    <Link
      href={`/contacts/${contact.contactId}`}
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        padding: '12px 14px',
        background: '#FFFFFF',
        border: hottest ? '1px solid rgba(196,98,45,0.4)' : '1px solid rgba(140,123,107,0.2)',
        borderRadius: 8,
        boxShadow: hottest ? '0 2px 10px rgba(196,98,45,0.14)' : 'none',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'all 180ms cubic-bezier(0.16,1,0.3,1)',
      }}
    >
      <PersonAvatar initials={contact.initials} identity={contact.identity} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#1A1612', whiteSpace: 'nowrap' }}>{contact.name}</span>
          <IdentityGradient state={contact.identity} />
          {hottest && (
            <span style={hottestPillStyle}>
              <Flame style={{ width: 10, height: 10 }} /> Hottest
            </span>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: '#5E5246', marginBottom: 8 }}>{contact.read}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span aria-hidden style={{ width: 64, height: 6, borderRadius: 3, background: 'rgba(140,123,107,0.18)', overflow: 'hidden', flexShrink: 0 }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.round(contact.pct * 100)}%`, background: tier.color }} />
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: tier.color }}>{tier.word}</span>
          {contact.delta > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#8C7B6B' }}>
              <ArrowUp style={{ width: 11, height: 11 }} /> +{contact.delta} this wk
            </span>
          )}
          {contact.lastSeen && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#8C7B6B', marginLeft: 'auto' }}>{relativeWhen(contact.lastSeen)}</span>
          )}
        </div>
      </div>
      <ArrowRight style={{ width: 14, height: 14, color: '#5E5246', flexShrink: 0, marginTop: 4 }} />
    </Link>
  )
}

// ── Compact cards (CONTEXT) ───────────────────────────────────────────────────

function EngagingCard({ contact }: { contact: CirclingContact }) {
  return (
    <Link href={`/contacts/${contact.contactId}`} style={compactCardStyle}>
      <PersonAvatar initials={contact.initials} identity={contact.identity} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1612', marginBottom: 4 }}>{contact.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <RoleBadge role="engaged" count={contact.delta > 1 ? contact.delta : undefined} />
          {contact.lastSeen && <span style={{ fontSize: 11, color: '#8C7B6B' }}>· {relativeWhen(contact.lastSeen)}</span>}
        </div>
      </div>
      <ArrowRight style={{ width: 13, height: 13, color: '#5E5246', flexShrink: 0 }} />
    </Link>
  )
}

function RoleAttachedCard({ role }: { role: PropertyDetailRoleAttached }) {
  return (
    <Link href={`/contacts/${role.contactId}`} style={compactCardStyle}>
      <PersonAvatar initials={role.initials} identity={role.identity} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1612', marginBottom: 4 }}>{role.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <RoleBadge role={role.role} />
          <span style={{ fontSize: 11, color: '#8C7B6B' }}>· {relativeWhen(role.date)}</span>
        </div>
      </div>
      <ArrowRight style={{ width: 13, height: 13, color: '#5E5246', flexShrink: 0 }} />
    </Link>
  )
}

// ── Timeline ──────────────────────────────────────────────────────────────────

function TimelineEntry({ row, isLast }: { row: PropertyTimelineRow; isLast: boolean }) {
  if (row.kind === 'moment') {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ width: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, paddingTop: 2 }}>
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#C4622D', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Flame style={{ width: 7, height: 7, color: '#FAF7F2' }} />
          </span>
          {!isLast && <span style={{ width: 1, flex: 1, background: 'rgba(140,123,107,0.2)', marginTop: 3, minHeight: 16 }} />}
        </div>
        <div style={{ flex: 1, paddingBottom: 18, minWidth: 0 }}>
          <div style={momentCardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#C4622D' }}>Moment</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1612' }}>{row.label}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8C7B6B', marginLeft: 'auto' }}>{relativeWhen(row.occurredAt)}</span>
            </div>
            <div style={{ fontSize: 12.5, color: '#5E5246', lineHeight: 1.5 }}>{row.detail}</div>
            {row.tie && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, fontSize: 12, fontWeight: 500, color: '#C4622D' }}>
                <Zap style={{ width: 12, height: 12 }} /> {row.tie}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  const anon = row.kind === 'anon'
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
      <div style={{ width: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, paddingTop: 4 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: anon ? 'transparent' : '#C4622D',
            border: anon ? '2px dashed #8C7B6B' : '2px solid #C4622D',
          }}
        />
        {!isLast && <span style={{ width: 1, flex: 1, background: 'rgba(140,123,107,0.2)', marginTop: 3, minHeight: 16 }} />}
      </div>
      <div style={{ flex: 1, paddingBottom: 18, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
          {anon ? (
            <span style={{ fontSize: 13, fontStyle: 'italic', color: '#8C7B6B' }}>Anonymous visitor</span>
          ) : (
            <Link href={row.contactId ? `/contacts/${row.contactId}` : '#'} style={{ fontSize: 13, fontWeight: 600, color: '#1A1612', textDecoration: 'none' }}>
              {row.contactName}
            </Link>
          )}
          <Eye style={{ width: 12, height: 12, color: '#8C7B6B' }} />
          <span style={{ fontSize: 13, color: '#2E2823' }}>{row.label}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8C7B6B', marginLeft: 'auto' }}>{relativeWhen(row.occurredAt)}</span>
        </div>
        {row.detail && <div style={{ fontSize: 12, color: '#8C7B6B', lineHeight: 1.5 }}>{row.detail}</div>}
      </div>
    </div>
  )
}

// ── State pills ───────────────────────────────────────────────────────────────

const STATUS_ORDER: PropertyStatus[] = ['watching', 'appraising', 'listed', 'sold']

function StatePill({ status, active, onClick }: { status: PropertyStatus; active: boolean; onClick: () => void }) {
  const s = STATE_STYLE[status]
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 9999,
        fontSize: 12.5,
        fontWeight: 500,
        cursor: 'pointer',
        background: active ? s.bg : 'transparent',
        border: `1px solid ${active ? 'rgba(196,98,45,0.4)' : 'rgba(140,123,107,0.2)'}`,
        color: active ? s.fg : '#8C7B6B',
        fontFamily: 'var(--font-body)',
      }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: active ? s.dot : '#8C7B6B' }} />
      {s.label}
    </button>
  )
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function PanelHeader({ title, subtitle, count, actions }: { title: string; subtitle: string; count?: number; actions?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
      <div>
        <h2 className="font-display" style={{ fontSize: 19, fontWeight: 600, color: '#1A1612', letterSpacing: '-0.01em', margin: '0 0 2px' }}>{title}</h2>
        <p style={{ margin: 0, fontSize: 12, color: '#8C7B6B' }}>{subtitle}</p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {count != null && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#8C7B6B', background: 'rgba(140,123,107,0.1)', padding: '2px 9px', borderRadius: 9999 }}>{count}</span>
        )}
        {actions}
      </div>
    </div>
  )
}

function GroupLabel({ Icon, label, note }: { Icon: LucideIcon; label: string; note: string }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#5E5246', marginBottom: 10 }}>
      <Icon style={{ width: 11, height: 11 }} />
      {label}
      <span style={{ fontSize: 10, color: '#8C7B6B', textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontStyle: 'italic', marginLeft: 4 }}>· {note}</span>
    </div>
  )
}

function FilterBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ padding: '4px 11px', fontSize: 11, fontWeight: 500, color: active ? '#1A1612' : '#8C7B6B', background: active ? 'rgba(140,123,107,0.12)' : 'transparent', border: '1px solid transparent', borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
      {label}
    </button>
  )
}

function SheetRow({ Icon, label, last, onClick }: { Icon: LucideIcon; label: string; last?: boolean; onClick: () => void }) {
  return (
    <div role="button" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 12px', fontSize: 14, color: '#1A1612', fontWeight: 500, borderBottom: last ? 'none' : '1px solid rgba(140,123,107,0.14)', cursor: 'pointer' }}>
      <Icon style={{ width: 17, height: 17, color: '#8C7B6B' }} />
      {label}
    </div>
  )
}

const FILTER_LABEL: Record<TimelineFilter, string> = { all: 'All', known: 'Known', moments: 'Moments', anon: 'Anonymous' }

// ── Styles ────────────────────────────────────────────────────────────────────

const metaPillStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 9999, background: 'rgba(140,123,107,0.1)', color: '#8C7B6B' }
const readCardStyle: React.CSSProperties = { background: '#FAF7F2', border: '1px solid rgba(140,123,107,0.2)', borderRadius: 11, padding: '14px 16px', marginBottom: 18 }
const autoPillStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 500, padding: '3px 9px', borderRadius: 9999, background: 'rgba(140,123,107,0.1)', color: '#8C7B6B' }
const textBtnStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: '#C4622D', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font-body)' }
const chipStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 500, padding: '4px 10px', borderRadius: 9999, background: '#FAF7F2', border: '1px solid rgba(140,123,107,0.2)', color: '#5E5246' }
const groupLabelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#5E5246' }
const anonNoteStyle: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 10, background: 'rgba(46,40,35,0.04)', borderRadius: 8, padding: '11px 14px', marginTop: 8 }
const streamLinkStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: '#8C7B6B', textDecoration: 'none', marginTop: 14 }
const recCardStyle: React.CSSProperties = { background: '#FAF7F2', border: '1px solid rgba(140,123,107,0.2)', borderRadius: 12, padding: '16px 18px', boxShadow: '0 1px 3px rgba(26,22,18,0.06)' }
const primaryBtnStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 9, background: '#C4622D', color: '#F5F0E8', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', textDecoration: 'none', boxShadow: '0 2px 8px rgba(196,98,45,0.28)' }
const ghostBtnStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 8, background: 'transparent', color: '#1A1612', fontSize: 12.5, fontWeight: 500, border: '1px solid rgba(140,123,107,0.3)', cursor: 'pointer', fontFamily: 'var(--font-body)', textDecoration: 'none' }
const iconBtnStyle: React.CSSProperties = { width: 34, height: 34, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', textDecoration: 'none' }
const panelStyle: React.CSSProperties = { background: '#FAF7F2', border: '1px solid rgba(140,123,107,0.2)', borderRadius: 12, padding: '20px 22px', marginBottom: 16 }
const compactCardStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: '#FFFFFF', border: '1px solid rgba(140,123,107,0.2)', borderRadius: 8, textDecoration: 'none', color: 'inherit', cursor: 'pointer', transition: 'all 180ms cubic-bezier(0.16,1,0.3,1)' }
const hottestPillStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 9999, background: 'rgba(196,98,45,0.1)', color: '#C4622D' }
const momentCardStyle: React.CSSProperties = { background: 'rgba(196,98,45,0.06)', border: '1px solid rgba(196,98,45,0.22)', borderRadius: 9, padding: '11px 14px' }
const sheetStyle: React.CSSProperties = { position: 'fixed', left: 14, right: 14, bottom: 'calc(56px + 64px + env(safe-area-inset-bottom))', background: '#FAF7F2', border: '1px solid rgba(140,123,107,0.2)', borderRadius: 14, boxShadow: '0 8px 32px rgba(26,22,18,0.18)', padding: 6, zIndex: 39 }
const stickyBarStyle: React.CSSProperties = { position: 'fixed', left: 0, right: 0, bottom: 'calc(56px + env(safe-area-inset-bottom))', padding: '12px 16px', background: '#F5F0E8', borderTop: '1px solid rgba(140,123,107,0.14)', display: 'flex', gap: 10, zIndex: 39 }

function gridStyle(isMobile: boolean): React.CSSProperties {
  return { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeWhen(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  const d = Math.floor(diff / 86_400_000)
  if (d === 1) return '1 day ago'
  if (d < 7) return `${d} days ago`
  if (d < 30) return `${Math.floor(d / 7)}w ago`
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
