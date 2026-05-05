import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Bell } from 'lucide-react'
import { ClaudeButton } from '@/components/ui/claude-button'
import { SignalFilters } from '@/components/dashboard/signal-filters'

// ── Intent helpers ────────────────────────────────────────────────────────────

type Intent = 'high' | 'mid' | 'low' | 'none'

function getIntent(score: number): Intent {
  if (score >= 50) return 'high'
  if (score >= 20) return 'mid'
  if (score >= 5)  return 'low'
  return 'none'
}

const DOT_COLOR: Record<Intent, string> = {
  high: '#C4622D', mid: '#B5922A', low: '#3D5246', none: '#8C7B6B',
}
const INTENT_LABEL: Record<Intent, string> = {
  high: 'High intent', mid: 'Mid intent', low: 'Watching', none: 'Quiet',
}
const INTENT_BG: Record<Intent, string> = {
  high: 'rgba(196,98,45,0.1)', mid: 'rgba(181,146,42,0.1)', low: 'rgba(61,82,70,0.1)', none: 'rgba(140,123,107,0.1)',
}
const INTENT_FG: Record<Intent, string> = {
  high: '#C4622D', mid: '#8A6A00', low: '#3D5246', none: '#8C7B6B',
}

function getNudge(score: number, topEvent: string | null): string {
  const hasReturn = topEvent === 'return_visit'
  const hasForm   = topEvent === 'form_submit'
  if (score >= 80) return 'Repeatedly active, high score. This one is ready — reach out today.'
  if (score >= 60) return hasForm
    ? 'Submitted a form and keeps coming back. High-value contact — act now.'
    : 'Strong engagement across multiple sessions. Appraisal-level interest.'
  if (score >= 50) return hasReturn
    ? 'Back again — classic pre-appraisal behaviour. Worth a proactive call.'
    : 'High intent signals detected. Worth a call this week.'
  if (score >= 35) return 'Mid-level engagement building steadily. Keep an eye on this one.'
  if (score >= 20) return 'Building interest across a few visits. Horace is tracking the activity.'
  if (score >= 10) return 'Early signals. Too soon to act, but worth watching.'
  return 'Quiet so far. Horace is watching.'
}

function getTags(eventReasons: string[]): string[] {
  const tags: string[] = []
  if (eventReasons.includes('form_submit'))    tags.push('Form submitted')
  if (eventReasons.includes('return_visit'))   tags.push('Return visit')
  if (eventReasons.includes('property_view'))  tags.push('Property views')
  if (eventReasons.includes('scroll_depth'))   tags.push('Deep reading')
  return tags.slice(0, 2)
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { filter?: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const agentId = agent?.id!

  // Fetch contacts ordered by score
  let query = admin
    .from('contacts')
    .select('id, first_name, last_name, email, score, last_seen_at')
    .eq('agent_id', agentId)
    .order('score', { ascending: false })
    .limit(20)

  const filter = searchParams.filter ?? 'all'
  if (filter === 'high') query = query.gte('score', 50)
  else if (filter === 'mid') { query = query.gte('score', 20); query = query.lt('score', 50) }
  else if (filter === 'low') { query = query.gte('score', 5); query = query.lt('score', 20) }

  const { data: contacts } = await query

  // Fetch recent score_history for all returned contacts to derive event tags
  const contactIds = (contacts ?? []).map(c => c.id)
  const { data: history } = contactIds.length
    ? await admin
        .from('score_history')
        .select('contact_id, reason')
        .eq('agent_id', agentId)
        .in('contact_id', contactIds)
        .order('occurred_at', { ascending: false })
    : { data: [] }

  // Group reasons by contact_id
  const reasonsByContact: Record<string, string[]> = {}
  for (const h of history ?? []) {
    if (!reasonsByContact[h.contact_id]) reasonsByContact[h.contact_id] = []
    reasonsByContact[h.contact_id].push(h.reason)
  }

  // Count for summary
  const { count: totalHigh } = await admin
    .from('contacts')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .gte('score', 50)

  const signals = (contacts ?? []).map(c => {
    const name    = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Unknown'
    const intent  = getIntent(c.score)
    const reasons = reasonsByContact[c.id] ?? []
    const topEvent = reasons[0] ?? null
    return { ...c, name, intent, nudge: getNudge(c.score, topEvent), tags: getTags(reasons) }
  })

  return (
    <div className="p-8 space-y-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-semibold tracking-tight" style={{ fontSize: '26px', color: '#1A1612' }}>
            Signals
          </h1>
          <p style={{ fontSize: '13px', color: '#8C7B6B', marginTop: '2px' }}>
            What Horace picked up this week.
          </p>
        </div>
        <ClaudeButton
          prompt={`I'm a real estate agent using Horace. I have ${totalHigh ?? 0} high-intent contacts right now. My top signals are: ${signals.slice(0, 3).map(s => `${s.name} (score ${s.score}, ${INTENT_LABEL[s.intent as Intent]})`).join(', ')}. Who should I focus on and what should I say?`}
          label="Review with Claude"
        />
      </div>

      {/* Filter pills */}
      <SignalFilters active={filter} />

      {/* Signal cards */}
      {signals.length === 0 ? (
        <div className="text-center py-16" style={{ color: '#8C7B6B' }}>
          <Bell className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium" style={{ color: '#1A1612' }}>
            Horace is watching. Nothing worth your attention yet.
          </p>
          <p className="text-xs mt-2" style={{ color: '#8C7B6B' }}>
            <Link href="/import" className="hover:underline">Import your contacts</Link>
            {' '}or{' '}
            <Link href="/settings/snippet" className="hover:underline">install the tracking snippet</Link>
            {' '}to get started.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {signals.map(signal => (
            <SignalCard key={signal.id} signal={signal} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Signal card ───────────────────────────────────────────────────────────────

function SignalCard({ signal }: {
  signal: {
    id: string
    name: string
    score: number
    last_seen_at: string | null
    intent: string
    nudge: string
    tags: string[]
    first_name: string | null
  }
}) {
  const intent  = signal.intent as Intent
  const dotColor    = DOT_COLOR[intent]
  const intentLabel = INTENT_LABEL[intent]
  const intentBg    = INTENT_BG[intent]
  const intentFg    = INTENT_FG[intent]
  const time = signal.last_seen_at
    ? formatDistanceToNow(new Date(signal.last_seen_at), { addSuffix: true })
    : 'Not seen'

  return (
    <Link
      href={`/leads/${signal.id}`}
      style={{
        display: 'block',
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.2)',
        borderRadius: '8px',
        padding: '16px 18px',
        boxShadow: '0 1px 3px rgba(26,22,18,0.07)',
        textDecoration: 'none',
        transition: 'box-shadow 180ms cubic-bezier(0.16,1,0.3,1)',
      }}
      className="group signal-card"
    >
      <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
        {/* Intent dot */}
        <div style={{
          width: '10px', height: '10px', borderRadius: '50%',
          background: dotColor, flexShrink: 0, marginTop: '5px',
        }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Name + time */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#1A1612' }}>
              {signal.name}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#8C7B6B', flexShrink: 0 }}>
              {time}
            </span>
          </div>

          {/* Nudge */}
          <p style={{ fontSize: '13px', color: '#2E2823', lineHeight: 1.55, margin: 0 }}>
            &ldquo;{signal.nudge}&rdquo;
          </p>

          {/* Tags */}
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '8px' }}>
            <span style={{
              fontSize: '11px', fontWeight: 500,
              background: intentBg, color: intentFg,
              padding: '2px 8px', borderRadius: '9999px',
            }}>
              {intentLabel}
            </span>
            {signal.tags.map(tag => (
              <span key={tag} style={{
                fontSize: '11px', fontWeight: 500,
                background: 'rgba(140,123,107,0.1)', color: '#8C7B6B',
                padding: '2px 8px', borderRadius: '9999px',
              }}>
                {tag}
              </span>
            ))}
          </div>

          {/* CTA */}
          {intent === 'high' && signal.first_name && (
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#C4622D', marginTop: '10px' }}>
              Call {signal.first_name} →
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}
