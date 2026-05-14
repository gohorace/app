import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DigestView, type DigestViewModel } from '@/components/digest/digest-view'
import { type DigestSignal } from '@/components/digest/signal-card'
import { intentForScore, guidanceForEventType } from '@/lib/design/intent'
import {
  generateContactInsight,
  generateBriefingNarrative,
  type ContactEvent,
} from '@/lib/ai/briefing'

// Server component — always fresh. Calls the same RPCs the daily-briefing
// cron uses, so the in-app digest is content-true with whatever email was
// sent this morning (provided the agent doesn't refresh too far past the
// 24h window the RPC reads).
export const dynamic = 'force-dynamic'

export default async function DigestPage({
  searchParams,
}: {
  searchParams: { demo?: string }
}) {
  // ?demo=1 — design-review affordance. Skips the RPC + AI entirely and
  // renders the design's canonical mock cast (Priya / Sarah / Marcus /
  // David / Claire) so we can verify visuals on a preview where the test
  // workspace has no recent score_history. The DEMO DATA chip in the
  // topbar makes this unambiguous in screenshots.
  //
  // Gated behind VERCEL_ENV — production deploys ignore the flag so users
  // can never accidentally see mock data, regardless of URL.
  const allowDemo = process.env.VERCEL_ENV !== 'production'
  if (searchParams.demo === '1' && allowDemo) {
    return <DigestView model={demoModel()} />
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, first_name, last_name, email')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent) {
    return <DigestView model={emptyModel(null)} />
  }

  // HOR-138: workspace site URL for the "Post on social" activity prompt.
  const { data: settings } = await admin
    .from('agent_settings')
    .select('website_url')
    .eq('agent_id', agent.id)
    .maybeSingle()
  const websiteUrl = settings?.website_url ?? null

  const agentName =
    [agent.first_name, agent.last_name].filter(Boolean).join(' ') ||
    agent.email ||
    'Your Agent'

  // ── Fetch leads via the briefing RPC ─────────────────────────────────────
  const { data: rawLeads } = await admin.rpc('get_daily_briefing_data', {
    p_agent_id: agent.id,
  })
  const leads = rawLeads ?? []

  if (leads.length === 0) {
    return <DigestView model={emptyModel(websiteUrl)} />
  }

  // ── Enrich each lead in parallel: events + suburb + AI insight ───────────
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  let anthropic: import('@anthropic-ai/sdk').default | null = null
  if (anthropicKey) {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    anthropic = new Anthropic({ apiKey: anthropicKey })
  }

  // Suburbs in one shot, keyed by contact id.
  const { data: suburbRows } = await admin
    .from('contacts')
    .select('id, suburb')
    .in('id', leads.map((l) => l.contact_id))
  const suburbByContact = new Map<string, string | null>(
    (suburbRows ?? []).map((r) => [r.id, r.suburb ?? null]),
  )

  type EnrichedLead = {
    contactId: string
    firstName: string | null
    lastName: string | null
    email: string | null
    score: number
    scoreChange: number
    lastSeenAt: string | null
    eventCount: number
    suburb: string | null
    events: ContactEvent[]
    nudge: string
    tags: string[]
    topEventType: string | null
  }

  const enriched: EnrichedLead[] = await Promise.all(
    leads.map(async (lead) => {
      const { data: rawEvents } = await admin.rpc('get_contact_events', {
        p_contact_id: lead.contact_id,
      })
      const events: ContactEvent[] = (rawEvents ?? []).slice(0, 10).map((e) => ({
        event_type: e.event_type,
        properties: (e.properties ?? {}) as Record<string, unknown>,
        score_delta: e.score_delta,
        occurred_at: e.occurred_at,
      }))

      const insight = anthropic
        ? await generateContactInsight(anthropic, agentName, lead, events).catch(() => null)
        : null

      const displayName =
        [lead.first_name, lead.last_name].filter(Boolean).join(' ') ||
        lead.email ||
        'A contact'

      return {
        contactId: lead.contact_id,
        firstName: lead.first_name,
        lastName:  lead.last_name,
        email:     lead.email,
        score:     lead.score,
        scoreChange: lead.score_change,
        lastSeenAt: lead.last_seen_at,
        eventCount: lead.event_count,
        suburb: suburbByContact.get(lead.contact_id) ?? null,
        events,
        nudge: insight?.why_now ?? `${displayName} has been active on your site recently.`,
        tags: deriveTags(events, lead.event_count),
        topEventType: events[0]?.event_type ?? null,
      }
    }),
  )

  // ── Generate Horace narrative (best-effort) ──────────────────────────────
  const narrative = anthropic
    ? await generateBriefingNarrative(
        anthropic,
        agentName,
        enriched.map((l) => ({
          first_name: l.firstName,
          last_name:  l.lastName,
          score:      l.score,
          score_change: l.scoreChange,
          topEventType: l.topEventType,
        })),
        'today',
      ).catch(() => '')
    : ''

  // ── Shape the view-model ─────────────────────────────────────────────────
  const signals: DigestSignal[] = enriched.map((l) => {
    const intent = intentForScore(l.score) ?? 'low'
    return {
      contactId: l.contactId,
      name: [l.firstName, l.lastName].filter(Boolean).join(' ') || l.email || 'A contact',
      initials: makeInitials(l.firstName, l.lastName, l.email),
      suburb: l.suburb,
      timing: formatTiming(l.lastSeenAt),
      intent,
      guidance: guidanceForEventType(l.topEventType),
      nudge: l.nudge,
      tags: l.tags,
    }
  })

  // "Newly known" = leads whose top event is a form_submit or return_visit.
  // Tighter heuristic comes with the anon→known variant later.
  const newlyKnown = enriched.filter(
    (l) => l.topEventType === 'form_submit' || l.topEventType === 'return_visit',
  ).length

  const model: DigestViewModel = {
    dateLabel: new Date().toLocaleDateString('en-AU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
    sentAtLabel: null, // Cron timestamp lookup deferred — see HOR-122 backlog.
    narrative,
    signals,
    stats: {
      worthAttention: signals.length,
      highIntent: signals.filter((s) => s.intent === 'high').length,
      newlyKnown,
    },
    rail: realRail(),
    websiteUrl,
  }

  return <DigestView model={model} />
}

// ─── Demo dataset ────────────────────────────────────────────────────────────
// Mirrors the four canonical signals in the design's screens.jsx so we can
// verify the populated layout on a preview without seeding real activity.
// Only renders when ?demo=1 is set — never served by default.

function demoModel(): DigestViewModel {
  const signals: DigestSignal[] = [
    // Lead card: the anonymous-becomes-known moment. Banner + tinted bg
    // makes this the most visually weighted signal in the roster.
    {
      contactId: 'demo-priya-raman',
      name: 'Priya Raman',
      initials: 'PR',
      suburb: 'Paddington, NSW',
      timing: 'Identified 12 min ago',
      intent: 'high',
      guidance: 'contextual',
      nudge: 'Horace had been watching this one for two weeks. She just put her name to it.',
      tags: ['Newly identified', '14 sessions', '14 anonymous sessions'],
      pillLabel: 'Newly known',
      isAnonymousNowKnown: true,
    },
    {
      contactId: 'demo-sarah-thompson',
      name: 'Sarah Thompson',
      initials: 'ST',
      suburb: 'Paddington, NSW',
      timing: 'Active 2h ago',
      intent: 'high',
      guidance: 'advisory',
      nudge: 'She’s been on the appraisal page twice this week. Lead with that.',
      tags: ['Appraisal', '3 sessions', 'Returning'],
    },
    {
      contactId: 'demo-marcus-bell',
      name: 'Marcus Bell',
      initials: 'MB',
      suburb: 'Glebe, NSW',
      timing: 'Active this morning',
      intent: 'high',
      guidance: 'time-sensitive',
      nudge: 'Started a contact form, didn’t send. Catch him before he tries someone else.',
      tags: ['Contact form', 'Near-submit'],
    },
    {
      contactId: 'demo-david-nguyen',
      name: 'David Nguyen',
      initials: 'DN',
      suburb: 'Surry Hills, NSW',
      timing: 'Yesterday',
      intent: 'mid',
      guidance: 'contextual',
      nudge: 'Browsing sold results on Maple Street. Classic pre-appraisal pattern.',
      tags: ['Sold results', 'Maple St'],
    },
    {
      contactId: 'demo-claire-adeyemi',
      name: 'Claire Adeyemi',
      initials: 'CA',
      suburb: 'Newtown, NSW',
      timing: '3 days ago',
      intent: 'low',
      guidance: 'contextual',
      nudge: 'Downloaded the Newtown report. Early-stage, but she came back for it.',
      tags: ['Suburb report'],
    },
  ]

  return {
    dateLabel: new Date().toLocaleDateString('en-AU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
    sentAtLabel: '6:02 am',
    narrative:
      'Four contacts worth your attention today. Sarah Thompson looks ready — she’s been on the appraisal page twice this week. Marcus Bell got close to a contact form. And someone I’d been watching for a fortnight just put her name to it.',
    signals,
    stats: {
      worthAttention: 4,
      highIntent: 2,
      newlyKnown: 1,
    },
    rail: demoRail(),
    websiteUrl: 'https://jamesreid.com.au',
    isDemo: true,
  }
}

function demoRail() {
  return {
    lists: [
      { name: 'Warming up',         count: 6,  accent: 'high' as const },
      { name: 'Watch closely',      count: 4,  accent: 'high' as const },
      { name: 'Quiet but circling', count: 8,  accent: 'low'  as const },
      { name: 'Paddington vendors', count: 12, accent: 'none' as const },
    ],
    weekSoFar: [
      { day: 'MON' as const, count: 3,    isToday: false },
      { day: 'TUE' as const, count: 5,    isToday: false },
      { day: 'WED' as const, count: 4,    isToday: true  },
      { day: 'THU' as const, count: null, isToday: false },
      { day: 'FRI' as const, count: null, isToday: false },
    ],
    weekNote: 'Quiet Thursday and Friday — Horace will tell you when something stirs.',
  }
}

// Real-mode rail. Lists feature deferred (HOR-122 backlog) — render an
// empty Lists card. Week-so-far data needs persisted digest history
// (also deferred) — render the day strip with the current weekday
// highlighted but no counts yet.
function realRail() {
  const todayShort = new Date()
    .toLocaleDateString('en-AU', { weekday: 'short' })
    .toUpperCase()
    .slice(0, 3) as 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI'
  return {
    lists: [], // empty → card shows "Lists coming soon" copy
    weekSoFar: (['MON', 'TUE', 'WED', 'THU', 'FRI'] as const).map((day) => ({
      day,
      count: null,
      isToday: day === todayShort,
    })),
    weekNote: 'Your week-at-a-glance lands here once Horace has a few days of digests under its belt.',
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyModel(websiteUrl: string | null): DigestViewModel {
  return {
    dateLabel: new Date().toLocaleDateString('en-AU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
    sentAtLabel: null,
    narrative: '',
    signals: [],
    stats: { worthAttention: 0, highIntent: 0, newlyKnown: 0 },
    rail: realRail(),
    websiteUrl,
  }
}

function makeInitials(
  first: string | null,
  last: string | null,
  email: string | null,
): string {
  const fromName = [first?.[0], last?.[0]].filter(Boolean).join('').toUpperCase()
  if (fromName) return fromName
  if (email) return email[0]?.toUpperCase() ?? '?'
  return '?'
}

function formatTiming(iso: string | null): string {
  if (!iso) return 'Quiet'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'Quiet'
  const diffMs = Date.now() - then
  if (diffMs < 60 * 1000) return 'Just now'
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `Active ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Active ${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w ago`
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

/**
 * Pick up to 3 tag chips from the contact's recent events. Surfaces event
 * types in a friendly form, plus a session count if non-trivial.
 */
function deriveTags(events: ContactEvent[], eventCount: number): string[] {
  const tags: string[] = []
  const seen = new Set<string>()

  for (const e of events) {
    const label = friendlyEventLabel(e)
    if (label && !seen.has(label)) {
      seen.add(label)
      tags.push(label)
      if (tags.length >= 2) break
    }
  }

  if (eventCount >= 3) {
    tags.push(`${eventCount} sessions`)
  }

  return tags.slice(0, 3)
}

function friendlyEventLabel(e: ContactEvent): string | null {
  switch (e.event_type) {
    case 'form_submit':   return 'Contact form'
    case 'return_visit':  return 'Returning'
    case 'property_view': return 'Property view'
    case 'page_view': {
      const path = (e.properties.path as string | undefined) ?? ''
      if (path.includes('appraisal')) return 'Appraisal'
      if (path.includes('sold'))      return 'Sold results'
      return null
    }
    case 'scroll_depth':   return null
    case 'campaign_click': return 'Campaign click'
    default: return null
  }
}
