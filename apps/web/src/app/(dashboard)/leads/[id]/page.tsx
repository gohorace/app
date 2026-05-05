import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import { formatDistanceToNow, format } from 'date-fns'
import {
  ArrowLeft,
  Mail,
  Phone,
  Home,
  FileText,
  RotateCcw,
  Globe,
  ExternalLink,
} from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────

type Intent = 'high' | 'mid' | 'low' | 'none'

function getIntent(score: number): Intent {
  if (score >= 50) return 'high'
  if (score >= 20) return 'mid'
  if (score >= 5)  return 'low'
  return 'none'
}

const INTENT_LABEL: Record<Intent, string> = {
  high: 'High intent',
  mid:  'Mid intent',
  low:  'Watching',
  none: 'Quiet',
}

const INTENT_COLOR: Record<Intent, string> = {
  high: '#C4622D',
  mid:  '#8A6A00',
  low:  '#3D5246',
  none: '#8C7B6B',
}

const INTENT_BG: Record<Intent, string> = {
  high: 'rgba(196,98,45,0.1)',
  mid:  'rgba(181,146,42,0.1)',
  low:  'rgba(61,82,70,0.1)',
  none: 'rgba(140,123,107,0.1)',
}

const INTENT_NUDGE: Record<Intent, string> = {
  high: 'Worth a call this week.',
  mid:  'Interest is building — keep watching.',
  low:  'Early signals. Horace is watching.',
  none: 'Quiet so far.',
}

/** Human-readable label for each event type */
function eventLabel(type: string, props: Record<string, unknown>): string {
  switch (type) {
    case 'property_view': {
      const addr = props.address ?? props.title
      return addr ? `Viewed a listing — ${addr}` : 'Viewed a property listing'
    }
    case 'form_submit': {
      const form = props.form_name ?? props.form_id
      return form ? `Submitted "${form}"` : 'Sent an enquiry'
    }
    case 'return_visit':
      return 'Came back to your site'
    case 'page_view': {
      const title = props.title
      return title ? `Read "${title}"` : 'Visited your website'
    }
    default:
      return type.replace(/_/g, ' ')
  }
}

/** Human-readable label for score history reasons */
function scoreReason(reason: string): string {
  switch (reason) {
    case 'page_view':      return 'Visited a page'
    case 'property_view':  return 'Viewed a listing'
    case 'form_submit':    return 'Submitted an enquiry'
    case 'return_visit':   return 'Came back to the site'
    case 'scroll_depth':   return 'Read content in depth'
    default:               return reason.replace(/_/g, ' ')
  }
}

/** Strip scroll_depth — consolidate it into nearby page views conceptually */
function shouldShowEvent(type: string): boolean {
  return type !== 'scroll_depth' && type !== 'campaign_click'
}

/** Get the URL to link from an event, if any */
function eventUrl(props: Record<string, unknown>): string | null {
  const raw = props.url ?? props.path
  if (!raw || typeof raw !== 'string') return null
  return raw
}

function formatEventUrl(raw: string): string {
  try {
    const u = new URL(raw)
    return u.hostname + u.pathname
  } catch {
    return raw
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const agentId = agent!.id

  const [
    { data: contact },
    { data: contactEvents },
    { data: scoreHistory },
  ] = await Promise.all([
    admin
      .from('contacts')
      .select('*')
      .eq('id', params.id)
      .eq('agent_id', agentId)
      .maybeSingle(),
    admin.rpc('get_contact_events', { p_contact_id: params.id }),
    admin
      .from('score_history')
      .select('id, delta, reason, score_after, occurred_at')
      .eq('contact_id', params.id)
      .eq('agent_id', agentId)
      .order('occurred_at', { ascending: false })
      .limit(8),
  ])

  if (!contact) notFound()

  const events = (contactEvents ?? [])
    .map((e) => ({
      id:          e.event_id,
      event_type:  e.event_type,
      properties:  (e.properties ?? {}) as Record<string, unknown>,
      score_delta: e.score_delta,
      occurred_at: e.occurred_at,
    }))
    .filter((e) => shouldShowEvent(e.event_type))

  const name   = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unknown'
  const initials = [contact.first_name?.[0], contact.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?'
  const intent = getIntent(contact.score)

  return (
    <div style={{ padding: '24px 28px', maxWidth: '780px' }}>

      {/* Back */}
      <Link
        href="/leads"
        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#8C7B6B', textDecoration: 'none', fontSize: '13px', marginBottom: '20px' }}
      >
        <ArrowLeft style={{ width: '14px', height: '14px' }} />
        All contacts
      </Link>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '24px' }}>
        {/* Avatar */}
        <div style={{
          width: '48px', height: '48px', borderRadius: '50%',
          background: intent === 'high' ? '#C4622D' : intent === 'mid' ? '#B5922A' : '#8C7B6B',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <span style={{ fontSize: '16px', fontWeight: 700, color: '#FAF7F2', fontFamily: 'var(--font-display)' }}>
            {initials}
          </span>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#1A1612', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>
              {name}
            </h1>
            <span style={{
              fontSize: '11px', fontWeight: 600,
              background: INTENT_BG[intent], color: INTENT_COLOR[intent],
              padding: '2px 9px', borderRadius: '9999px',
            }}>
              {INTENT_LABEL[intent]}
            </span>
          </div>
          <p style={{ fontSize: '13px', color: '#8C7B6B', margin: '2px 0 0' }}>
            {INTENT_NUDGE[intent]}
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: '16px', alignItems: 'start' }}>

        {/* ── Left: timeline ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Contact details */}
          <div style={{
            background: '#FAF7F2',
            border: '1px solid rgba(140,123,107,0.2)',
            borderRadius: '10px',
            padding: '16px 18px',
          }}>
            <p style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8C7B6B', marginBottom: '12px' }}>
              Contact
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {contact.email && (
                <a href={`mailto:${contact.email}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', color: '#1A1612', fontSize: '13px' }}>
                  <Mail style={{ width: '14px', height: '14px', color: '#8C7B6B', flexShrink: 0 }} />
                  {contact.email}
                </a>
              )}
              {contact.phone && (
                <a href={`tel:${contact.phone}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', color: '#1A1612', fontSize: '13px' }}>
                  <Phone style={{ width: '14px', height: '14px', color: '#8C7B6B', flexShrink: 0 }} />
                  {contact.phone}
                </a>
              )}
              <div style={{ display: 'flex', gap: '24px', paddingTop: '10px', borderTop: '1px solid rgba(140,123,107,0.12)', fontSize: '12px' }}>
                <div>
                  <p style={{ color: '#8C7B6B', margin: 0 }}>First seen</p>
                  <p style={{ color: '#1A1612', fontWeight: 500, margin: '2px 0 0' }}>
                    {contact.identified_at ? format(new Date(contact.identified_at), 'd MMM yyyy') : '—'}
                  </p>
                </div>
                <div>
                  <p style={{ color: '#8C7B6B', margin: 0 }}>Last seen</p>
                  <p style={{ color: '#1A1612', fontWeight: 500, margin: '2px 0 0' }}>
                    {contact.last_seen_at ? formatDistanceToNow(new Date(contact.last_seen_at), { addSuffix: true }) : '—'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Activity timeline */}
          <div style={{
            background: '#FAF7F2',
            border: '1px solid rgba(140,123,107,0.2)',
            borderRadius: '10px',
            padding: '16px 18px',
          }}>
            <p style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8C7B6B', marginBottom: '16px' }}>
              Activity
            </p>

            {events.length === 0 ? (
              <p style={{ fontSize: '13px', color: '#8C7B6B', textAlign: 'center', padding: '20px 0' }}>
                No website activity recorded yet.
              </p>
            ) : (
              <div style={{ position: 'relative' }}>
                {events.map((event, i) => {
                  const props = event.properties
                  const label = eventLabel(event.event_type, props)
                  const url   = eventUrl(props)
                  const isLast = i === events.length - 1

                  return (
                    <div key={event.id} style={{ display: 'flex', gap: '12px', paddingBottom: isLast ? 0 : '16px' }}>
                      {/* Icon + line */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '28px', flexShrink: 0 }}>
                        <div style={{
                          width: '28px', height: '28px', borderRadius: '50%',
                          background: event.event_type === 'form_submit'
                            ? 'rgba(196,98,45,0.12)'
                            : event.event_type === 'return_visit'
                              ? 'rgba(61,82,70,0.1)'
                              : 'rgba(140,123,107,0.1)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>
                          <TimelineIcon type={event.event_type} />
                        </div>
                        {!isLast && (
                          <div style={{ width: '1px', flex: 1, background: 'rgba(140,123,107,0.15)', marginTop: '4px' }} />
                        )}
                      </div>

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0, paddingTop: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                          <p style={{
                            fontSize: '13px',
                            fontWeight: event.event_type === 'form_submit' || event.event_type === 'return_visit' ? 600 : 500,
                            color: event.event_type === 'form_submit' ? '#C4622D' : '#1A1612',
                            margin: 0,
                            lineHeight: 1.4,
                          }}>
                            {label}
                          </p>
                          <span style={{ fontSize: '11px', color: '#8C7B6B', flexShrink: 0, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                            {formatDistanceToNow(new Date(event.occurred_at), { addSuffix: true })}
                          </span>
                        </div>

                        {url && (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: '4px',
                              fontSize: '11px', color: '#8C7B6B', textDecoration: 'none',
                              marginTop: '3px',
                            }}
                          >
                            <ExternalLink style={{ width: '10px', height: '10px' }} />
                            {formatEventUrl(url)}
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: score card ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Score */}
          <div style={{
            background: '#FAF7F2',
            border: '1px solid rgba(140,123,107,0.2)',
            borderRadius: '10px',
            padding: '16px 18px',
          }}>
            <p style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8C7B6B', marginBottom: '10px' }}>
              Intent score
            </p>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
              <span style={{ fontSize: '48px', fontWeight: 700, color: '#1A1612', letterSpacing: '-0.03em', lineHeight: 1, fontFamily: 'var(--font-body)' }}>
                {contact.score}
              </span>
              <span style={{ fontSize: '13px', color: INTENT_COLOR[intent], fontWeight: 600 }}>
                {INTENT_LABEL[intent]}
              </span>
            </div>
            <p style={{ fontSize: '12px', color: '#8C7B6B', margin: '8px 0 0' }}>
              Score rises as {contact.first_name ?? 'they'} engage with your site.
            </p>
          </div>

          {/* Score history */}
          {scoreHistory && scoreHistory.length > 0 && (
            <div style={{
              background: '#FAF7F2',
              border: '1px solid rgba(140,123,107,0.2)',
              borderRadius: '10px',
              padding: '16px 18px',
            }}>
              <p style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8C7B6B', marginBottom: '12px' }}>
                How they scored
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {scoreHistory.map((s) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <span style={{ fontSize: '12px', color: '#2E2823', flex: 1, minWidth: 0 }}>
                      {scoreReason(s.reason)}
                    </span>
                    <span style={{
                      fontSize: '11px', fontWeight: 600,
                      color: s.delta > 0 ? '#C4622D' : '#8C7B6B',
                      fontFamily: 'var(--font-mono)',
                      flexShrink: 0,
                    }}>
                      {s.delta > 0 ? `+${s.delta}` : s.delta}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Timeline icon ─────────────────────────────────────────────────────────────

function TimelineIcon({ type }: { type: string }) {
  const style = { width: '13px', height: '13px' }
  switch (type) {
    case 'property_view': return <Home      style={{ ...style, color: '#8C7B6B' }} />
    case 'form_submit':   return <FileText  style={{ ...style, color: '#C4622D' }} />
    case 'return_visit':  return <RotateCcw style={{ ...style, color: '#3D5246' }} />
    case 'page_view':
    default:              return <Globe     style={{ ...style, color: '#8C7B6B' }} />
  }
}
