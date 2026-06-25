'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Anchor,
  Bell,
  Eye,
  Flame,
  Home,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import {
  IdentityGradient,
  PropertyThumb,
  RoleBadge,
  toneFor,
  type ContactRole,
} from '@/lib/design/badges'
import type { IdentityState } from '@/lib/design/badges'
import { eventKind, eventLabel, eventUrl, formatEventUrl, type MergedEvent } from '@/lib/contacts/events'
import { tierForScore, weeklyDelta, whatChanged, readProvenance } from '@/lib/contacts/signal-summary'
import { HoraceReadCard } from '@/components/shared/horace-read-card'
import { AttachRoleDialog } from './attach-role-dialog'
import { NotesThread } from '@/components/notes/notes-thread'
import { useComposerDock } from '@/components/email/composer-dock-context'
import { AddToListSheet } from '@/components/lists/add-to-list-sheet'
import { buildEmailSendIndex, type EmailSendSummary } from '@/lib/contacts/email-engagement'
import { useCompanion } from '@/components/companion/companion-context'

export interface ContactDetailViewProps {
  contact: {
    id:           string
    firstName:    string | null
    lastName:     string | null
    email:        string | null
    phone:        string | null
    suburb:       string | null
    lastSeenAt:   string | null
    identifiedAt: string | null
    score:        number
    source:       string
    /** Free-text notes on the contact. Persisted on contacts.metadata.notes. */
    notes:        string | null
    /** HOR-246: Horace-voiced "why now" read. Server populates it from the
     *  same cached insight pipeline /digest uses. Drives the Signal block's
     *  "Why now · Horace's read" paragraph; absent → that block is omitted. */
    nudge?:       string | null
    /** HOR-246: the recommended next move (insight.action) — drives the
     *  Action block's primary recommendation-card sub-line. */
    recommendation?: string | null
  }
  identity: IdentityState
  initials: string
  sessionsThisWeek: number
  /** Role-attached properties (Seller/Buyer from metadata). */
  roleAttached: Array<{
    roleId:    string
    role:      ContactRole
    date:      string
    propertyId: string
    address:   string
    suburb:    string | null
  }>
  /** Properties from recent property_view events (transient engagement). */
  engagingNow: Array<{
    propertyId: string
    address:    string
    suburb:     string | null
    lastViewAt: string
    sessions:   number
  }>
  events: MergedEvent[]
  /** HOR-228: per-contact email_sends summary, indexed by id at render time. */
  emailSends?: EmailSendSummary[]
}

type TimelineFilter = 'all' | 'visits' | 'roles' | 'emails'

// ── Mobile breakpoint (matches Tailwind `md`) ────────────────────────────────
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

export function ContactDetailView({
  contact,
  identity,
  initials: _initials,
  sessionsThisWeek: _sessionsThisWeek,
  roleAttached,
  engagingNow,
  events,
  emailSends = [],
}: ContactDetailViewProps) {
  const router = useRouter()
  const { openCompanion } = useCompanion()
  const { openComposer } = useComposerDock()
  const isMobile = useIsMobile()
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>('all')
  const [attachOpen, setAttachOpen] = useState(false)
  const [removingRoleId, setRemovingRoleId] = useState<string | null>(null)
  const [addToListOpen, setAddToListOpen] = useState(false)
  // HOR-246 mobile: the "act now" set lives in an overflow sheet above the
  // sticky Draft CTA.
  const [overflowOpen, setOverflowOpen] = useState(false)

  const isAnon = identity === 'anonymous'
  const displayName =
    [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
    contact.email ||
    `Visitor · ${contact.id.slice(0, 4)}`
  // ── Identity provenance (HOR-246 amendment) ──────────────────────────────
  // Agent-supplied name leads; the observed email is the locked anchor. When
  // no name is set, the email itself is the hero (the "email-only" state).
  const hasName = Boolean(contact.firstName || contact.lastName)
  const seenLabel = `seen via ${contact.source}`
  const companionName =
    [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email || 'this contact'

  // ── Signal derivations (pure, over the events already on the page) ────────
  const tier = useMemo(() => tierForScore(contact.score), [contact.score])
  const delta = useMemo(() => weeklyDelta(events), [events])
  const changes = useMemo(() => whatChanged(events), [events])
  const builtFrom = useMemo(() => readProvenance(events), [events])

  const lastSeenLabel = useMemo(() => {
    if (!contact.lastSeenAt) return '—'
    const diff = Date.now() - new Date(contact.lastSeenAt).getTime()
    if (diff < 60_000) return 'Just now'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
    const d = Math.floor(diff / 86_400_000)
    if (d === 1) return 'Yesterday'
    if (d < 7) return `${d} days ago`
    return new Date(contact.lastSeenAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  }, [contact.lastSeenAt])

  // ── Timeline (kept from v2-M5: funnel-stage email dots + filters) ─────────
  type TimelineRow = {
    key: string
    kind: 'visit' | 'role' | 'email'
    emailKind?: 'sent' | 'opened' | 'clicked' | 'bounced' | 'other'
    title: string
    detail: string | null
    when: string
    occurredAt: string
  }
  const emailSendIndex = useMemo(() => buildEmailSendIndex(emailSends), [emailSends])
  const timeline: TimelineRow[] = useMemo(() => {
    const rows: TimelineRow[] = []
    for (const e of events) {
      const kind = eventKind(e)
      if (kind === 'email') {
        const sendId = typeof e.properties.email_send_id === 'string'
          ? (e.properties.email_send_id as string)
          : null
        const send = sendId ? emailSendIndex.get(sendId) ?? null : null
        const emailKind: NonNullable<TimelineRow['emailKind']> =
          e.event_type === 'email_sent'    ? 'sent'    :
          e.event_type === 'email_opened'  ? 'opened'  :
          e.event_type === 'email_clicked' ? 'clicked' :
          e.event_type === 'email_bounced' ? 'bounced' :
                                             'other'
        rows.push({
          key:        `event-${e.id}`,
          kind:       'email',
          emailKind,
          title:      eventLabel(e, send?.subject ?? null),
          detail:     null,
          when:       relativeWhen(e.occurred_at),
          occurredAt: e.occurred_at,
        })
        continue
      }
      const url = eventUrl(e.properties)
      rows.push({
        key:        `event-${e.id}`,
        kind:       'visit',
        title:      eventLabel(e),
        detail:     url ? formatEventUrl(url) : null,
        when:       relativeWhen(e.occurred_at),
        occurredAt: e.occurred_at,
      })
    }
    for (const r of roleAttached) {
      rows.push({
        key:        `role-${r.roleId}`,
        kind:       'role',
        title:      `Attached as ${r.role === 'seller' ? 'Vendor' : 'Buyer'} of ${r.address}`,
        detail:     null,
        when:       relativeWhen(r.date),
        occurredAt: r.date,
      })
    }
    return rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  }, [events, roleAttached, emailSendIndex])

  const filteredTimeline = useMemo(() => {
    if (timelineFilter === 'all') return timeline
    if (timelineFilter === 'visits') return timeline.filter((r) => r.kind === 'visit')
    if (timelineFilter === 'emails') return timeline.filter((r) => r.kind === 'email')
    return timeline.filter((r) => r.kind === 'role')
  }, [timeline, timelineFilter])

  async function handleRemoveRole(roleId: string) {
    if (removingRoleId) return
    setRemovingRoleId(roleId)
    try {
      await fetch(`/api/contacts/${contact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remove_role_id: roleId }),
      })
      router.refresh()
    } finally {
      setRemovingRoleId(null)
    }
  }

  // Email → tracked-email composer dock, opened in the auto-draft state so
  // Horace pre-loads a draft tuned to the read. The dock owns the rest of the
  // compose lifecycle (tracking on by default; an untracked toggle lives inside
  // the dock, never at the top level).
  function openEmailDraft() {
    if (!contact.email) return
    openComposer({
      contactId: contact.id,
      recipient: contact.email,
      contactName: companionName,
      source: 'contact',
      autoDraft: true,
      signalContext: contact.nudge
        ? { label: contact.nudge, detail: contact.suburb ?? undefined }
        : undefined,
    })
  }

  // "Ask Horace" on the read card → Companion in *read* context.
  function openAsk() {
    openCompanion({
      prompt: `Tell me more about why ${companionName} matters right now`,
      contextLabel: `Contact: ${companionName}`,
    })
  }

  // HOR-246 amendment (Phase 2a): "Edit details" + the field invitations open
  // the Companion drawer rendering the structured IdentityEditForm — the
  // decided edit surface. The observed email is carried for display only and
  // stays locked; the form writes the agent-supplied fields via PATCH.
  function openEdit(field?: 'name' | 'phone') {
    openCompanion({
      contextLabel: `Contact: ${companionName}`,
      edit: {
        contactId:   contact.id,
        focusField:  field,
        displayName: hasName ? displayName : null,
        phone:       contact.phone,
        email:       contact.email,
        seenLabel,
      },
    })
  }

  // Roles the contact currently holds, for the RoleControl pill "active" state.
  const heldRoles = useMemo(() => new Set(roleAttached.map((r) => r.role)), [roleAttached])

  return (
    <div style={{ flex: 1, overflowY: 'auto', position: 'relative', paddingBottom: isMobile ? 132 : 80 }}>
      <div style={{ maxWidth: 880, padding: isMobile ? '18px 16px 16px' : '30px 32px 40px' }}>
        {/* Header — breadcrumb on desktop, back/name/bell on mobile */}
        {isMobile ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 18,
            }}
          >
            <Link href="/contacts" aria-label="Back to contacts" style={iconBtnStyle}>
              <ArrowLeft style={{ width: 17, height: 17, color: '#1A1612' }} />
            </Link>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#1A1612',
                maxWidth: 200,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {!hasName && contact.email ? 'Email-only visitor' : displayName}
            </span>
            <Link href="/digest" aria-label="Stream" style={iconBtnStyle}>
              <Bell style={{ width: 17, height: 17, color: '#8C7B6B' }} />
            </Link>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 22,
              fontSize: 13,
            }}
          >
            <Link
              href="/contacts"
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
              Contacts
            </Link>
            <span style={{ color: 'rgba(140,123,107,0.4)' }}>/</span>
            <span style={{ color: '#1A1612', fontWeight: 500 }}>{displayName}</span>
          </div>
        )}

        {/* ── SIGNAL ─────────────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            gap: isMobile ? 18 : 30,
            alignItems: 'flex-start',
            flexDirection: isMobile ? 'column' : 'row',
          }}
        >
          <TempDial
            pct={tier.pct}
            color={tier.color}
            word={tier.word}
            delta={delta}
            size={isMobile ? 120 : 152}
            stroke={isMobile ? 11 : 13}
          />
          <div style={{ flex: 1, minWidth: 0, paddingTop: isMobile ? 6 : 4 }}>
            {/* identity meta row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <IdentityGradient state={identity} size="lg" />
              <span style={metaPillStyle}>
                <Zap style={{ width: 11, height: 11 }} />
                {contact.source}
              </span>
              {!isAnon && contact.lastSeenAt && (
                <span style={{ fontSize: 12, color: '#8C7B6B' }}>
                  Active <strong style={{ color: '#1A1612', fontWeight: 500 }}>{lastSeenLabel}</strong>
                </span>
              )}
              {!isAnon && !isMobile && <EditDetailsBtn onClick={() => openEdit()} />}
            </div>

            {/* NAME cluster — provenance: agent-supplied name leads; the observed
                email is demoted to a locked line beneath. Email-only/unnamed →
                the email is the hero + a "tell Horace who this is" invitation. */}
            {isAnon ? (
              <h1 className="font-display" style={{ ...nameH1Style, fontSize: isMobile ? 28 : 34 }}>
                {displayName}
              </h1>
            ) : hasName ? (
              <>
                <h1 className="font-display" style={{ ...nameH1Style, fontSize: isMobile ? 28 : 34 }}>
                  {displayName}
                </h1>
                {contact.email && (
                  <div style={{ marginBottom: 10 }}>
                    <LockedLine icon={Mail} value={contact.email} seen={seenLabel} compact={isMobile} />
                  </div>
                )}
              </>
            ) : (
              <>
                <h1
                  className="font-display"
                  style={{ ...nameH1Style, fontSize: isMobile ? 20 : 25, wordBreak: 'break-all' }}
                >
                  {contact.email ?? displayName}
                </h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', margin: '4px 0 12px' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: '#8C7B6B',
                      fontStyle: 'italic',
                    }}
                  >
                    <Lock style={{ width: 11, height: 11 }} /> {seenLabel} — locked
                  </span>
                  <InviteChip icon={Plus} label="Tell Horace who this is" onClick={() => openEdit('name')} />
                </div>
              </>
            )}

            {/* FACTS — phone (agent-supplied: editable, or an invite when
                unset) + suburb as a quiet read-only locality tag. Suburb isn't
                editable here: "Properties they're circling" below carries the
                meaningful location signal. Hidden for anonymous. */}
            {!isAnon && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                {contact.phone ? (
                  <EditableFact icon={Phone} value={contact.phone} onClick={() => openEdit('phone')} />
                ) : (
                  <InviteChip icon={Phone} label="Add a phone" onClick={() => openEdit('phone')} />
                )}
                {contact.suburb && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12.5,
                      color: '#8C7B6B',
                    }}
                  >
                    <MapPin style={{ width: 12, height: 12 }} />
                    {contact.suburb}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── WHY NOW — Horace's read (authored, sourced card) ─────────────── */}
        {contact.nudge && contact.nudge.trim().length > 0 && (
          <div style={{ marginTop: isMobile ? 20 : 24 }}>
            <HoraceReadCard
              read={contact.nudge}
              updated={contact.lastSeenAt ? lastSeenLabel : null}
              builtFrom={builtFrom}
              changes={changes}
              chipColor={tier.color}
              streamHref={!isAnon && contact.lastSeenAt ? '/digest' : null}
              streamWhen={!isAnon && contact.lastSeenAt ? lastSeenLabel : null}
              onAsk={openAsk}
              compact={isMobile}
            />
          </div>
        )}

        {/* ── ACTION ─────────────────────────────────────────────────────── */}
        {/* Read says what's happening; the suggestion says what to do; the
            channel row lets you do it. Three things, one card. */}
        <div style={{ marginTop: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
            <Zap style={{ width: 13, height: 13, color: '#C4622D' }} />
            <span style={{ ...uppercaseTerracottaLabel, letterSpacing: '0.1em', fontSize: 11 }}>
              Horace&rsquo;s move
            </span>
          </div>
          <div
            style={{
              background: '#FAF7F2',
              border: '1px solid rgba(140,123,107,0.2)',
              borderRadius: 12,
              padding: isMobile ? '14px 16px' : '16px 18px',
              boxShadow: '0 1px 3px rgba(26,22,18,0.06)',
            }}
          >
            <div
              className="font-display"
              style={{ fontSize: isMobile ? 17 : 18.5, fontWeight: 600, color: '#1A1612', marginBottom: 4 }}
            >
              {primaryTitleForTier(tier.word)}
            </div>
            <p style={{ margin: 0, fontSize: 13, color: '#5E5246', lineHeight: 1.5, textWrap: 'pretty' }}>
              {contact.recommendation && contact.recommendation.trim().length > 0
                ? contact.recommendation
                : 'Horace can draft a follow-up tuned to what they’ve been looking at — review it, tweak the tone, and send in your voice.'}
            </p>

            {!isMobile && (
              <ChannelActionRow
                onEmail={openEmailDraft}
                emailDisabled={!contact.email}
                phone={contact.phone}
              />
            )}
          </div>
        </div>

        {/* ── CONTEXT ────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: isMobile ? '26px 0 16px' : '34px 0 22px' }}>
          <span style={contextDividerLabel}>Context</span>
          <div style={{ flex: 1, height: 1, background: 'rgba(140,123,107,0.14)' }} />
        </div>

        {/* Role control — Vendor / Buyer (maps to the property-attached
            seller/buyer roles; tapping opens the existing Attach-role flow). */}
        {!isAnon && (
          <div style={{ marginBottom: isMobile ? 18 : 20 }}>
            <RoleControl held={heldRoles} onPick={() => setAttachOpen(true)} />
          </div>
        )}

        {/* Properties they're circling */}
        <section style={panelStyle}>
          <PanelHeader
            title="Properties they’re circling"
            subtitle="One tap into Properties — where they’re putting their attention."
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
                Quiet on this one.
              </div>
              <div style={{ fontSize: 12, color: '#8C7B6B', lineHeight: 1.55 }}>
                Horace will tell you when something stirs.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {roleAttached.length > 0 && (
                <div>
                  <GroupLabel Icon={Anchor} label="Role-attached" note="durable, survives ownership change" />
                  <div style={contactGridStyle(isMobile)}>
                    {roleAttached.map((r) => (
                      <RoleAttachedCard
                        key={r.roleId}
                        role={r}
                        onRemove={handleRemoveRole}
                        removing={removingRoleId === r.roleId}
                      />
                    ))}
                  </div>
                </div>
              )}
              {engagingNow.length > 0 && (
                <div>
                  <GroupLabel Icon={Eye} label="Engaging now" note="this week’s behaviour" />
                  <div style={contactGridStyle(isMobile)}>
                    {engagingNow.map((p) => (
                      <EngagingNowCard key={p.propertyId} property={p} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Notes — HOR-252 threaded NotesThread (own card chrome). */}
        {!isAnon && (
          <div style={{ marginBottom: 18 }}>
            <NotesThread contactId={contact.id} subjectKind="contact" />
          </div>
        )}

        {/* Behavioural timeline */}
        <section style={panelStyle}>
          <PanelHeader
            title="Behavioural timeline"
            subtitle="The spine — every session, and the moment it became one."
            actions={
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <TimelineFilterBtn label="All" active={timelineFilter === 'all'} onClick={() => setTimelineFilter('all')} />
                <TimelineFilterBtn label="Visits" active={timelineFilter === 'visits'} onClick={() => setTimelineFilter('visits')} />
                <TimelineFilterBtn label="Emails" active={timelineFilter === 'emails'} onClick={() => setTimelineFilter('emails')} />
                <TimelineFilterBtn label="Roles" active={timelineFilter === 'roles'} onClick={() => setTimelineFilter('roles')} />
              </div>
            }
          />

          {filteredTimeline.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <p style={{ fontSize: 13, color: '#5E5246', fontWeight: 500, margin: '0 0 4px' }}>Quiet so far.</p>
              <p style={{ fontSize: 12, color: '#8C7B6B', margin: 0 }}>
                Horace is watching every visit — you&rsquo;ll see them land here.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {filteredTimeline.map((row, i) => {
                const isLast = i === filteredTimeline.length - 1
                const color =
                  row.kind === 'role'
                    ? '#3D5246'
                    : row.kind === 'email'
                      ? EMAIL_DOT_COLOR[row.emailKind ?? 'other']
                      : '#C4622D'
                const isEmail = row.kind === 'email'
                const kindLabel =
                  row.kind === 'role'
                    ? 'Role event'
                    : isEmail
                      ? EMAIL_KIND_LABEL[row.emailKind ?? 'other']
                      : 'Visit'
                const titleParts = isEmail ? splitEmailTitle(row.title, kindLabel) : null
                return (
                  <div key={row.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
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
                          borderRadius: isEmail ? 2 : '50%',
                          background: color,
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
                    <div style={{ flex: 1, paddingBottom: 18, minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                          marginBottom: 3,
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 600, color }}>{kindLabel}</span>
                        {titleParts ? (
                          <span style={{ fontSize: 13, color: '#2E2823' }}>
                            {titleParts.prefix}
                            {titleParts.subject && (
                              <span style={{ fontStyle: 'italic', color: '#5E5246' }}>
                                {' '}&ldquo;{titleParts.subject}&rdquo;
                              </span>
                            )}
                          </span>
                        ) : (
                          <span style={{ fontSize: 13, color: '#2E2823' }}>{row.title}</span>
                        )}
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10,
                            color: '#8C7B6B',
                            marginLeft: 'auto',
                          }}
                        >
                          {row.when}
                        </span>
                      </div>
                      {row.detail && (
                        <div style={{ fontSize: 12, color: '#8C7B6B', lineHeight: 1.5 }}>{row.detail}</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Sovereignty line */}
        <p
          style={{
            marginTop: 14,
            fontSize: 11,
            color: '#8C7B6B',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontStyle: 'italic',
          }}
        >
          <Anchor style={{ width: 12, height: 12 }} />
          Your people, your history — behaviour belongs to you, sovereign across every tool you ever use.
        </p>
      </div>

      {/* ── Mobile sticky CTA + overflow sheet ───────────────────────────── */}
      {/* Email is the primary sticky CTA. Phone sits beside it (channel-named,
          icon-only to keep the bar compact). SMS·soon + the management actions
          (edit / add to list / attach role) live in the overflow sheet. */}
      {isMobile && (
        <>
          {overflowOpen && (
            <div style={overflowSheetStyle}>
              {!isAnon && (
                <SheetRow
                  Icon={Pencil}
                  label="Edit details"
                  accent
                  onClick={() => { openEdit(); setOverflowOpen(false) }}
                />
              )}
              <SheetRow Icon={MessageSquare} label="SMS · soon" disabled />
              <SheetRow Icon={Plus} label="Add to list" onClick={() => { setAddToListOpen(true); setOverflowOpen(false) }} />
              {!isAnon && (
                <SheetRow Icon={Home} label="Attach role" last onClick={() => { setAttachOpen(true); setOverflowOpen(false) }} />
              )}
            </div>
          )}
          <div style={stickyBarStyle}>
            <button
              type="button"
              onClick={openEmailDraft}
              disabled={!contact.email}
              style={{
                ...primaryDraftBtnStyle,
                flex: 1,
                justifyContent: 'center',
                padding: '14px 18px',
                fontSize: 15,
                opacity: contact.email ? 1 : 0.5,
                cursor: contact.email ? 'pointer' : 'not-allowed',
              }}
              title={contact.email ? undefined : 'This contact has no email address on file'}
            >
              <Mail style={{ width: 16, height: 16 }} />
              Email
            </button>
            {contact.phone ? (
              <a
                href={`tel:${contact.phone}`}
                aria-label="Phone"
                style={{
                  width: 50,
                  borderRadius: 9,
                  background: '#FAF7F2',
                  border: '1px solid rgba(140,123,107,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textDecoration: 'none',
                }}
              >
                <Phone style={{ width: 18, height: 18, color: '#1A1612' }} />
              </a>
            ) : (
              <button
                type="button"
                aria-label="Phone (no number on file)"
                disabled
                style={{
                  width: 50,
                  borderRadius: 9,
                  background: '#FAF7F2',
                  border: '1px solid rgba(140,123,107,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0.5,
                  cursor: 'not-allowed',
                }}
              >
                <Phone style={{ width: 18, height: 18, color: '#8C7B6B' }} />
              </button>
            )}
            <button
              type="button"
              aria-label="More actions"
              onClick={() => setOverflowOpen((o) => !o)}
              style={{
                width: 50,
                borderRadius: 9,
                background: '#FAF7F2',
                border: '1px solid rgba(140,123,107,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: overflowOpen ? 'inset 0 0 0 1px rgba(196,98,45,0.4)' : 'none',
              }}
            >
              <MoreHorizontal style={{ width: 20, height: 20, color: overflowOpen ? '#C4622D' : '#8C7B6B' }} />
            </button>
          </div>
        </>
      )}

      <AddToListSheet
        open={addToListOpen}
        onClose={() => setAddToListOpen(false)}
        contactId={contact.id}
        subjectLabel={companionName}
      />

      {attachOpen && (
        <AttachRoleDialog
          contactId={contact.id}
          contactFirstName={contact.firstName}
          onClose={() => setAttachOpen(false)}
        />
      )}
    </div>
  )
}

// ── Temperature dial — the Signal hero (replaces the avatar) ─────────────────

function TempDial({
  pct,
  color,
  word,
  delta,
  size,
  stroke,
}: {
  pct: number
  color: string
  word: string
  delta: number | null
  size: number
  stroke: number
}) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const dash = circ * pct
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(140,123,107,0.16)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Flame style={{ width: size * 0.15, height: size * 0.15, color, marginBottom: 3 }} strokeWidth={1.7} />
        <div className="font-display" style={{ fontSize: size * 0.185, fontWeight: 600, color: '#1A1612', lineHeight: 1 }}>
          {word}
        </div>
      </div>
      {delta != null && (
        <div
          style={{
            position: 'absolute',
            bottom: -6,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '3px 9px',
            borderRadius: 9999,
            whiteSpace: 'nowrap',
            background: '#FAF7F2',
            border: `1px solid ${color}`,
            color,
            fontSize: 11,
            fontWeight: 600,
            fontFamily: 'var(--font-mono)',
            boxShadow: '0 1px 3px rgba(26,22,18,0.08)',
          }}
        >
          <ArrowUp style={{ width: 11, height: 11 }} strokeWidth={2.2} />
          +{delta} this wk
        </div>
      )}
    </div>
  )
}

function primaryTitleForTier(word: string): string {
  if (word === 'Hot') return 'Make your move today'
  if (word === 'Warming') return 'Reach out without crowding them'
  return 'Keep this one warm'
}

// ── Identity provenance atoms (HOR-246 amendment) ────────────────────────────

const nameH1Style: React.CSSProperties = {
  fontWeight: 600,
  color: '#1A1612',
  letterSpacing: '-0.02em',
  lineHeight: 1.08,
  margin: '0 0 4px',
}

/** Observed fact — locked. Lock glyph + value + light "seen via …" provenance. */
function LockedLine({
  icon: Icon,
  value,
  seen,
  compact,
}: {
  icon: LucideIcon
  value: string
  seen: string
  compact?: boolean
}) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: compact ? 12 : 12.5 }}>
      <Lock style={{ width: 11, height: 11, color: '#8C7B6B' }} />
      <span style={{ color: '#5E5246', wordBreak: 'break-all', fontWeight: 500 }}>{value}</span>
      <Icon style={{ width: 11, height: 11, color: '#8C7B6B' }} aria-hidden />
      <span style={{ color: '#8C7B6B', fontStyle: 'italic' }}>· {seen}</span>
    </div>
  )
}

/** Agent-supplied fact that's set — a quiet pill carrying a faint edit cue. */
function EditableFact({ icon: Icon, value, onClick }: { icon: LucideIcon; value: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="Edit — agent-supplied" style={editableFactStyle}>
      <Icon style={{ width: 12, height: 12, color: '#8C7B6B' }} />
      {value}
      <Pencil style={{ width: 10, height: 10, color: 'rgba(140,123,107,0.65)', marginLeft: 1 }} />
    </button>
  )
}

/** Unset agent field — an invitation, never a mandatory blank. Terracotta dashed. */
function InviteChip({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={inviteChipStyle}>
      <Icon style={{ width: 12, height: 12, color: '#C4622D' }} />
      {label}
    </button>
  )
}

/** The single, quiet entry point into the edit flow (opens the Companion). */
function EditDetailsBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={editDetailsBtnStyle}>
      <Pencil style={{ width: 12, height: 12, color: '#8C7B6B' }} />
      Edit details
    </button>
  )
}

// ── Role control — light "who is this to you?" ───────────────────────────────

const ROLE_PILLS: Array<{ role: ContactRole; label: string; Icon: typeof Home }> = [
  { role: 'seller', label: 'Vendor', Icon: Home },
  { role: 'buyer',  label: 'Buyer',  Icon: KeyRound },
]

function RoleControl({ held, onPick }: { held: Set<ContactRole>; onPick: () => void }) {
  const anyHeld = held.has('seller') || held.has('buyer')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, color: '#5E5246', fontWeight: 500 }}>Who is this to you?</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {ROLE_PILLS.map(({ role, label, Icon }) => {
          const on = held.has(role)
          return (
            <button
              key={role}
              type="button"
              onClick={onPick}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 9999,
                fontSize: 12.5,
                fontWeight: 500,
                cursor: 'pointer',
                background: on ? 'rgba(196,98,45,0.12)' : 'transparent',
                border: `1px solid ${on ? 'rgba(196,98,45,0.4)' : 'rgba(140,123,107,0.2)'}`,
                color: on ? '#C4622D' : '#8C7B6B',
                fontFamily: 'var(--font-body)',
              }}
            >
              <Icon style={{ width: 13, height: 13 }} />
              {label}
            </button>
          )
        })}
      </div>
      {!anyHeld && (
        <span style={{ fontSize: 11.5, color: '#8C7B6B', fontStyle: 'italic' }}>one tap — it sharpens the read</span>
      )}
    </div>
  )
}

// ── Channel action row — Email (primary) · Phone · SMS·soon ────────────────
// Same grammar as the stream card's CTA row, so both surfaces share one mental
// model. Email opens the dock with autoDraft + signalContext from the read;
// Phone reveals/dials when a number is on file; SMS is a disabled placeholder.

function ChannelActionRow({
  onEmail,
  emailDisabled,
  phone,
}: {
  onEmail: () => void
  emailDisabled: boolean
  phone: string | null
}) {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '9px 15px',
    borderRadius: 9,
    fontSize: 13.5,
    fontWeight: 500,
    fontFamily: 'var(--font-body)',
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={onEmail}
        disabled={emailDisabled}
        title={emailDisabled ? 'This contact has no email address on file' : undefined}
        style={{
          ...base,
          fontWeight: 600,
          border: 'none',
          background: '#C4622D',
          color: '#FBF4EE',
          cursor: emailDisabled ? 'not-allowed' : 'pointer',
          opacity: emailDisabled ? 0.5 : 1,
          boxShadow: '0 2px 8px rgba(196,98,45,0.24)',
        }}
      >
        <Mail style={{ width: 14, height: 14 }} aria-hidden /> Email
      </button>

      {phone ? (
        <a href={`tel:${phone}`} style={{ ...base, border: '1px solid rgba(140,123,107,0.2)', color: '#1A1612', textDecoration: 'none' }}>
          <Phone style={{ width: 14, height: 14, color: '#8C7B6B' }} aria-hidden /> Phone
        </a>
      ) : (
        <button
          type="button"
          disabled
          title="No phone number on file"
          style={{ ...base, border: '1px solid rgba(140,123,107,0.2)', color: 'rgba(140,123,107,0.7)', background: 'transparent', cursor: 'not-allowed' }}
        >
          <Phone style={{ width: 14, height: 14, color: 'rgba(140,123,107,0.7)' }} aria-hidden /> Phone
        </button>
      )}

      <span style={{ ...base, border: '1px dashed rgba(140,123,107,0.2)', color: 'rgba(140,123,107,0.85)', cursor: 'not-allowed' }}>
        <MessageSquare style={{ width: 14, height: 14, color: 'rgba(140,123,107,0.7)' }} aria-hidden /> SMS
        <span
          style={{
            padding: '1px 7px',
            borderRadius: 9999,
            background: 'rgba(140,123,107,0.16)',
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: '0.05em',
            color: '#8C7B6B',
            textTransform: 'uppercase',
          }}
        >
          Soon
        </span>
      </span>
    </div>
  )
}

function SheetRow({
  Icon,
  label,
  last,
  disabled,
  accent,
  onClick,
}: {
  Icon: typeof Phone
  label: string
  last?: boolean
  disabled?: boolean
  /** Terracotta-tinted — the new "Edit details" affordance (HOR-246). */
  accent?: boolean
  onClick?: () => void
}) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 12px',
        fontSize: 14,
        color: accent ? '#C4622D' : '#1A1612',
        fontWeight: 500,
        borderBottom: last ? 'none' : '1px solid rgba(140,123,107,0.14)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon style={{ width: 17, height: 17, color: accent ? '#C4622D' : '#8C7B6B' }} />
      {label}
    </div>
  )
}

// ── HOR-246: email funnel-stage timeline treatment ──────────────────────────

const EMAIL_DOT_COLOR: Record<NonNullable<EmailKind>, string> = {
  sent:    '#B5922A',
  opened:  '#8A6A00',
  clicked: '#C4622D',
  bounced: '#9C6B5A',
  other:   '#8A6A00',
}

const EMAIL_KIND_LABEL: Record<NonNullable<EmailKind>, string> = {
  sent:    'Sent',
  opened:  'Opened',
  clicked: 'Clicked',
  bounced: 'Bounced',
  other:   'Email',
}

type EmailKind = 'sent' | 'opened' | 'clicked' | 'bounced' | 'other'

function splitEmailTitle(title: string, kindLabel: string): { prefix: string; subject: string | null } {
  const idx = title.indexOf(' — "')
  let prefix = title
  let subject: string | null = null
  if (idx !== -1) {
    prefix = title.slice(0, idx)
    const rest = title.slice(idx + 4)
    subject = rest.endsWith('"') ? rest.slice(0, -1) : rest
  }
  const stripped = prefix.replace(new RegExp(`^${kindLabel}\\b\\s*`, 'i'), '').trim()
  return { prefix: stripped, subject }
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
          style={{ fontSize: 19, fontWeight: 600, color: '#1A1612', letterSpacing: '-0.01em', margin: '0 0 2px' }}
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

function GroupLabel({ Icon, label, note }: { Icon: typeof Anchor; label: string; note: string }) {
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

function RoleAttachedCard({
  role,
  onRemove,
  removing,
}: {
  role: ContactDetailViewProps['roleAttached'][number]
  onRemove: (roleId: string) => void
  removing: boolean
}) {
  const tone = toneFor(role.propertyId)
  return (
    <Link href={`/properties/${role.propertyId}`} style={{ ...propertyCardStyle, position: 'relative' }}>
      <PropertyThumb tone={tone} address={role.address} size={44} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1612', marginBottom: 4 }}>{role.address}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <RoleBadge role={role.role} />
          <span style={{ fontSize: 11, color: '#8C7B6B' }}>· {relativeWhen(role.date)}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (window.confirm('Remove this role?')) onRemove(role.roleId)
        }}
        title="Remove role"
        aria-label="Remove role"
        disabled={removing}
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          background: 'rgba(140,123,107,0.1)',
          color: '#5E5246',
          border: 'none',
          cursor: removing ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {removing ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <X style={{ width: 13, height: 13 }} />}
      </button>
    </Link>
  )
}

function EngagingNowCard({ property }: { property: ContactDetailViewProps['engagingNow'][number] }) {
  return (
    <Link href={`/properties/${property.propertyId}`} style={propertyCardStyle}>
      <PropertyThumb tone={toneFor(property.propertyId)} address={property.address} size={44} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1612', marginBottom: 4 }}>{property.address}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <RoleBadge role="engaged" count={property.sessions > 1 ? property.sessions : undefined} />
          <span style={{ fontSize: 11, color: '#8C7B6B' }}>· {relativeWhen(property.lastViewAt)}</span>
        </div>
      </div>
      <ArrowRight style={{ width: 13, height: 13, color: '#5E5246', flexShrink: 0 }} />
    </Link>
  )
}

function TimelineFilterBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 11px',
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

const uppercaseTerracottaLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#C4622D',
}

const editableFactStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 9px',
  borderRadius: 9999,
  background: 'transparent',
  border: '1px solid rgba(140,123,107,0.2)',
  color: '#5E5246',
  fontSize: 12.5,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
}

const inviteChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 11px',
  borderRadius: 9999,
  background: 'rgba(196,98,45,0.06)',
  border: '1px dashed rgba(196,98,45,0.45)',
  color: '#C4622D',
  fontSize: 12.5,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
}

const editDetailsBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 11px',
  borderRadius: 8,
  background: 'transparent',
  border: '1px solid rgba(140,123,107,0.2)',
  color: '#8C7B6B',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
  marginLeft: 'auto',
}

const contextDividerLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#8C7B6B',
}

const primaryDraftBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '12px 20px',
  borderRadius: 9,
  background: '#C4622D',
  color: '#F5F0E8',
  fontSize: 14.5,
  fontWeight: 600,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
  whiteSpace: 'nowrap',
  textDecoration: 'none',
  boxShadow: '0 2px 8px rgba(196,98,45,0.28)',
}

const iconBtnStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 8,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  textDecoration: 'none',
}

const panelStyle: React.CSSProperties = {
  background: '#FAF7F2',
  border: '1px solid rgba(140,123,107,0.2)',
  borderRadius: 12,
  padding: '20px 22px',
  marginBottom: 16,
}

function contactGridStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 8,
  }
}

const propertyCardStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 14px',
  background: '#FFFFFF',
  border: '1px solid rgba(140,123,107,0.2)',
  borderRadius: 8,
  textDecoration: 'none',
  color: 'inherit',
  cursor: 'pointer',
  transition: 'all 180ms cubic-bezier(0.16, 1, 0.3, 1)',
}

const stickyBarStyle: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 'calc(56px + env(safe-area-inset-bottom))',
  padding: '12px 16px 12px',
  background: '#F5F0E8',
  borderTop: '1px solid rgba(140,123,107,0.14)',
  display: 'flex',
  gap: 10,
  zIndex: 39,
}

const overflowSheetStyle: React.CSSProperties = {
  position: 'fixed',
  left: 14,
  right: 14,
  bottom: 'calc(56px + 64px + env(safe-area-inset-bottom))',
  background: '#FAF7F2',
  border: '1px solid rgba(140,123,107,0.2)',
  borderRadius: 14,
  boxShadow: '0 8px 32px rgba(26,22,18,0.18)',
  padding: 6,
  zIndex: 39,
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
