'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  Anchor,
  Lock,
  Database,
  Eye,
  Phone,
  Plus,
  TrendingUp,
  Loader2,
  X,
} from 'lucide-react'
import {
  IdentityGradient,
  PersonAvatar,
  PropertyThumb,
  RoleBadge,
  toneFor,
  type ContactRole,
} from '@/lib/design/badges'
import type { IdentityState } from '@/lib/design/badges'
import { eventKind, eventLabel, eventUrl, formatEventUrl, type MergedEvent } from '@/lib/contacts/events'
import { AttachRoleDialog } from './attach-role-dialog'
import { NotesThread } from '@/components/notes/notes-thread'
import { OpenComposerButton } from '@/components/email/open-composer-button'
import { AddToListSheet } from '@/components/lists/add-to-list-sheet'
import { buildEmailSendIndex, type EmailSendSummary } from '@/lib/contacts/email-engagement'
import { useCompanion } from '@/components/companion/companion-context'
import { QuillIcon } from '@/components/ui/quill-icon'

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
    /** Free-text notes on the contact. Persisted on contacts.notes (legacy
     *  column already in the schema — no migration needed). */
    notes:        string | null
    /** HOR-246: optional Horace-voiced nudge ("why now"). When present, the
     *  "Horace says" card renders under the action row. Server populates it
     *  from the same insight pipeline the digest uses; absent → no card. */
    nudge?:       string | null
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

export function ContactDetailView({
  contact,
  identity,
  initials,
  sessionsThisWeek,
  roleAttached,
  engagingNow,
  events,
  emailSends = [],
}: ContactDetailViewProps) {
  const router = useRouter()
  const { openCompanion } = useCompanion()
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>('all')
  const [attachOpen, setAttachOpen] = useState(false)
  const [removingRoleId, setRemovingRoleId] = useState<string | null>(null)
  // HOR-142: Add-to-list sheet state (replaces the disabled placeholder
  // button on the action row).
  const [addToListOpen, setAddToListOpen] = useState(false)

  const isAnon = identity === 'anonymous'
  const displayName =
    [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
    contact.email ||
    `Visitor · ${contact.id.slice(0, 4)}`
  const firstName = contact.firstName ?? displayName.split(' ')[0]

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

  // Merge metadata.roles into the timeline as `role` events, and email_*
  // events (slice F) as `email` rows. Kind-bucket each row so the filter
  // chips can slice cleanly.
  type TimelineRow = {
    key: string
    kind: 'visit' | 'role' | 'email'
    icon: 'eye' | 'home' | 'key-round' | 'mail'
    // HOR-246: granular email kind drives the v2 square-dot colour
    // (sent → mustard, opened → deeper mustard, clicked → terracotta).
    emailKind?: 'sent' | 'opened' | 'clicked' | 'bounced' | 'other'
    title: string
    detail: string | null
    when: string
    occurredAt: string
  }
  // O(1) lookup: email_sends row by id, for subject enrichment.
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
          icon:       'mail',
          emailKind,
          title:      eventLabel(e, send?.subject ?? null),
          // Email rows have a subject in the title — keep the second-line
          // detail clean. If we ever want recipient hash / open count etc.
          // it goes here.
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
        icon:       'eye',
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
        icon:       r.role === 'seller' ? 'home' : 'key-round',
        title:      `Attached as ${r.role === 'seller' ? 'Seller' : 'Buyer'} of ${r.address}`,
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

  return (
    <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 80 }}>
      <div style={{ maxWidth: 920, padding: '20px 32px' }}>
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

        {/* Hero */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '180px 1fr',
            gap: 28,
            marginBottom: 22,
            alignItems: 'flex-start',
          }}
        >
          {/* Avatar column */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <PersonAvatar
              initials={initials}
              identity={identity}
              size={180}
              anonymous={isAnon}
            />
          </div>

          {/* Info column */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <IdentityGradient state={identity} size="lg" />
              <span style={metaPillStyle}>
                <Database style={{ width: 11, height: 11 }} />
                {isAnon ? `Anonymous · ${contact.source}` : `Source: ${contact.source}`}
              </span>
              {!isAnon && (
                <span style={metaPillStyle}>
                  <Lock style={{ width: 11, height: 11 }} />
                  Read-only fields
                </span>
              )}
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
              {displayName}
            </h1>
            <div style={{ fontSize: 14, color: '#8C7B6B', marginBottom: 20 }}>
              {contact.suburb ?? 'Unknown suburb'}
              {!isAnon && (
                <>
                  {' · Active '}
                  <strong style={{ color: '#1A1612', fontWeight: 500 }}>{lastSeenLabel}</strong>
                </>
              )}
            </div>

            {/* Reference fields */}
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
              <ReferenceCell label="Email" value={contact.email} />
              <ReferenceCell label="Phone" value={contact.phone} />
              <ReferenceCell
                label="Sessions this week"
                value={String(sessionsThisWeek)}
                last
              />
            </div>

            {/* Actions */}
            {/*
              HOR-135: CRM-boundary language. The button label says "View
              phone number" — Horace shows the affordance; the agent dials
              from their device. Behaviour is still a tel: handoff (an OS
              action, not a Horace one), which is fine; only the label
              moves off the "Call X" framing.
            */}
            {/* HOR-246: v2 action row — Contact (terracotta) / Add to list /
                Draft with Horace are the primary three. Attach role + the
                real tracked-email send are kept alongside (their v2
                replacement — companion drafting wired to a real send — is
                still stubbed from M2, so dropping them now would regress
                actual sending). Flagged in the PR for a follow-up trim. */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {contact.phone ? (
                <a href={`tel:${contact.phone}`} style={primaryBtnStyle}>
                  <Phone style={{ width: 13, height: 13 }} />
                  Contact
                </a>
              ) : contact.email ? (
                <a href={`mailto:${contact.email}`} style={primaryBtnStyle}>
                  <Phone style={{ width: 13, height: 13 }} />
                  Contact
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  style={{ ...primaryBtnStyle, opacity: 0.5, cursor: 'not-allowed' }}
                  title="No phone or email on file"
                >
                  <Phone style={{ width: 13, height: 13 }} />
                  Contact
                </button>
              )}
              <button
                type="button"
                onClick={() => setAddToListOpen(true)}
                style={secondaryBtnStyle}
              >
                Add to list
              </button>
              <button
                type="button"
                onClick={() =>
                  openCompanion({
                    prompt: `Draft a follow-up to ${
                      [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
                      contact.email ||
                      'this contact'
                    }`,
                    contextLabel: `Contact: ${
                      [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
                      contact.email ||
                      'this contact'
                    }`,
                  })
                }
                style={secondaryBtnStyle}
              >
                <QuillIcon style={{ width: 13, height: 13 }} />
                Draft with Horace
              </button>
              {!isAnon && (
                <button
                  type="button"
                  onClick={() => setAttachOpen(true)}
                  style={secondaryBtnStyle}
                >
                  <Plus style={{ width: 13, height: 13 }} />
                  Attach role
                </button>
              )}
              {contact.email && (
                <OpenComposerButton
                  contactId={contact.id}
                  recipient={contact.email}
                  contactName={
                    [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
                    contact.email
                  }
                  source="contact"
                  buttonStyle={secondaryBtnStyle}
                />
              )}
              <AddToListSheet
                open={addToListOpen}
                onClose={() => setAddToListOpen(false)}
                contactId={contact.id}
                subjectLabel={
                  [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
                  contact.email ||
                  'this contact'
                }
              />
            </div>

            {/* HOR-246: "Horace says" nudge card — italic Playfair on a soft
                terracotta tint. Renders only when the server supplies a
                non-empty nudge. */}
            {contact.nudge && contact.nudge.trim().length > 0 && (
              <div
                style={{
                  marginTop: 14,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '12px 14px',
                  background: 'rgba(196,98,45,0.06)',
                  border: '1px solid rgba(196,98,45,0.18)',
                  borderRadius: 10,
                }}
              >
                <QuillIcon
                  style={{ width: 13, height: 13, flexShrink: 0, marginTop: 3 }}
                  color="#C4622D"
                />
                <p
                  className="font-display"
                  style={{
                    margin: 0,
                    fontStyle: 'italic',
                    fontSize: 14,
                    lineHeight: 1.55,
                    color: '#2E2823',
                  }}
                >
                  {contact.nudge}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Properties panel */}
        <section style={panelStyle}>
          <PanelHeader
            title="Properties"
            subtitle={
              isAnon
                ? 'Where this anonymous pattern has been engaging.'
                : 'Roles this person holds, and properties they’re engaging with right now.'
            }
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
                  <GroupLabel
                    Icon={Anchor}
                    label="Role-attached"
                    note="durable, survives ownership change"
                  />
                  <div style={contactGridStyle}>
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
                  <GroupLabel
                    Icon={TrendingUp}
                    label="Engaging now"
                    note="this week's behaviour"
                  />
                  <div style={contactGridStyle}>
                    {engagingNow.map((p) => (
                      <EngagingNowCard key={p.propertyId} property={p} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Notes — HOR-252 threaded NotesThread (replaces the v1 textarea). */}
        {!isAnon && (
          <div style={{ marginBottom: 18 }}>
            <NotesThread contactId={contact.id} subjectKind="contact" />
          </div>
        )}

        {/* Timeline */}
        <section style={panelStyle}>
          <PanelHeader
            title="Behavioural timeline"
            subtitle={
              isAnon
                ? 'Every session on this device.'
                : 'Sessions, page views, role events, identity changes.'
            }
            actions={
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <TimelineFilterBtn
                  label="All"
                  active={timelineFilter === 'all'}
                  onClick={() => setTimelineFilter('all')}
                />
                <TimelineFilterBtn
                  label="Visits"
                  active={timelineFilter === 'visits'}
                  onClick={() => setTimelineFilter('visits')}
                />
                <TimelineFilterBtn
                  label="Emails"
                  active={timelineFilter === 'emails'}
                  onClick={() => setTimelineFilter('emails')}
                />
                <TimelineFilterBtn
                  label="Roles + merges"
                  active={timelineFilter === 'roles'}
                  onClick={() => setTimelineFilter('roles')}
                />
              </div>
            }
          />

          {filteredTimeline.length === 0 ? (
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
              {filteredTimeline.map((row, i) => {
                const isLast = i === filteredTimeline.length - 1
                // HOR-246 per-kind accent. Email rows split by funnel stage:
                //   sent    → mustard
                //   opened  → deeper mustard
                //   clicked → terracotta
                //   bounced → muted clay
                // Non-email: role=forest, visit=horace-orange.
                const color =
                  row.kind === 'role'
                    ? '#3D5246'
                    : row.kind === 'email'
                      ? EMAIL_DOT_COLOR[row.emailKind ?? 'other']
                      : '#C4622D'
                // Email events read as squares; everything else stays round.
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
                          // Square (with a hair of rounding) for email funnel
                          // events; round for visits + role events.
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
                    <div style={{ flex: 1, paddingBottom: 18 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                          marginBottom: 3,
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 600, color }}>
                          {kindLabel}
                        </span>
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
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontStyle: 'italic',
          }}
        >
          Your people, your history. Behaviour belongs to you — sovereign across every tool you ever use.
        </p>
      </div>

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

// ── HOR-246: email funnel-stage timeline treatment ──────────────────────────

const EMAIL_DOT_COLOR: Record<NonNullable<EmailKind>, string> = {
  sent:    '#B5922A', // mustard
  opened:  '#8A6A00', // deeper mustard
  clicked: '#C4622D', // terracotta
  bounced: '#9C6B5A', // muted clay
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

/**
 * Split an `eventLabel` email string into a prefix + quoted subject so the
 * subject can render in italic next to the kind label. The leading stage
 * word (already shown as the coloured kind label) is stripped so we don't
 * render "Opened Opened"; any residual nuance — "(×3)", the Apple-MPP /
 * scanner notes — is preserved as the prefix.
 */
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
    <Link
      href={`/properties/${role.propertyId}`}
      style={{ ...propertyCardStyle, position: 'relative' }}
    >
      <PropertyThumb tone={tone} address={role.address} size={44} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1612', marginBottom: 4 }}>
          {role.address}
        </div>
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

function EngagingNowCard({
  property,
}: {
  property: ContactDetailViewProps['engagingNow'][number]
}) {
  return (
    <Link href={`/properties/${property.propertyId}`} style={propertyCardStyle}>
      <PropertyThumb tone={toneFor(property.propertyId)} address={property.address} size={44} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1612', marginBottom: 4 }}>
          {property.address}
        </div>
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

function ReferenceCell({ label, value, last }: { label: string; value: string | null; last?: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        padding: '12px 16px',
        borderRight: last ? 'none' : '1px solid rgba(140,123,107,0.14)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: '#8C7B6B',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, color: value ? '#1A1612' : '#8C7B6B', fontFamily: 'var(--font-body)' }}>
        {value ?? '—'}
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

const propertyCardStyle: React.CSSProperties = {
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
