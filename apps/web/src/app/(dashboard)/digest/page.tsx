import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DigestView, type DigestViewModel } from '@/components/digest/digest-view'
import { type DigestSignal } from '@/components/digest/signal-card'
import { type DigestRailData } from '@/components/digest/digest-rail'
import { intentForScore } from '@/lib/design/intent'
import { fetchAttentionCount } from '@/lib/notifications/attention-count'
import {
  generateContactInsight,
  generateBriefingNarrative,
  type ContactEvent,
  type ContactInsight,
} from '@/lib/ai/briefing'
import {
  derivePretext,
  fetchRecentSoldBySuburb,
  getCachedSignalDraft,
  type SignalDraft,
  type SignalPretext,
} from '@/lib/ai/signal-draft'

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
  if ((searchParams.demo === '1' || searchParams.demo === 'quiet') && allowDemo) {
    // 3 mirrors the bell-badge count in the design comp. ?demo=quiet shows the
    // ambient-only quiet-day permutation.
    const scenario = searchParams.demo === 'quiet' ? 'quiet' : 'live'
    return <DigestView model={{ ...demoModel(scenario), attentionCount: 3 }} />
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

  const attentionCount = await fetchAttentionCount(admin, agent.id)

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

  // No signal yet → show the demo roster so new agents see a concrete
  // preview of what the surface looks like with real data. websiteUrl and
  // attentionCount are the real values; everything else is illustrative.
  // isDemo:'preview' renders a "SAMPLE DATA" chip (vs "DEMO DATA" for ?demo=1)
  // so agents understand this is showing them what's coming, not their real data.
  if (leads.length === 0) {
    return <DigestView model={{ ...demoModel('live'), websiteUrl, attentionCount, isDemo: 'preview' }} />
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

  // Bulk "recent sold per suburb" lookup — fed into derivePretext below so
  // per-contact pretext sourcing is a cheap Map hit, not an N+1 SELECT.
  const suburbList = Array.from(new Set(
    Array.from(suburbByContact.values()).filter((s): s is string => Boolean(s)),
  ))
  const soldBySuburb = suburbList.length > 0
    ? await fetchRecentSoldBySuburb(admin, agent.id, suburbList)
    : new Map()

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
    /** Phase 2 — firewall pretext + AI draft. Both undefined when the model
     *  refused the firewall check or the API key is unset. */
    pretext?: SignalPretext
    draft?: SignalDraft
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

      const suburb = suburbByContact.get(lead.contact_id) ?? null

      // Insight + pretext in parallel — they hit independent surfaces.
      const [insight, pretext] = await Promise.all([
        anthropic
          ? getCachedInsight({ agentId: agent.id, agentName, lead, events }).catch(() => null)
          : Promise.resolve(null),
        derivePretext(admin, agent.id, { id: lead.contact_id, suburb }, soldBySuburb)
          .catch(() => null),
      ])

      // Draft generation depends on the pretext (firewall §5: no pretext →
      // no draft). Cached; tagged with the agent's digest. Null when the
      // model couldn't clear the banned-phrase check after a retry.
      const draft = anthropic && pretext
        ? await getCachedSignalDraft({
            agentId: agent.id,
            agentName,
            contact: {
              contact_id: lead.contact_id,
              first_name: lead.first_name,
              last_name:  lead.last_name,
              email:      lead.email,
            },
            pretext,
          }).catch(() => null)
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
        suburb,
        events,
        nudge: insight?.why_now ?? `${displayName} has been active on your site recently.`,
        tags: deriveTags(events, lead.event_count),
        topEventType: events[0]?.event_type ?? null,
        pretext:  pretext ?? undefined,
        draft:    draft ?? undefined,
      }
    }),
  )

  // ── Generate Horace narrative (best-effort, cached) ─────────────────────
  const narrative = anthropic
    ? await getCachedNarrative({
        agentId: agent.id,
        agentName,
        leads: enriched.map((l) => ({
          contactId:    l.contactId,
          first_name:   l.firstName,
          last_name:    l.lastName,
          score:        l.score,
          score_change: l.scoreChange,
          topEventType: l.topEventType,
        })),
      }).catch(() => '')
    : ''

  // ── Shape the view-model ─────────────────────────────────────────────────
  // Phase 2 (HOR-338): each known lead can now carry a firewall-safe pretext
  // + draft. `draft` is undefined when the API key is unset, no truthful
  // pretext survived, or the model couldn't clear the banned-phrase check —
  // those cards stay informational. Cards WITH a draft are workable and
  // count toward the Stream counter (signal-card §isWorkableSignal).
  const signals: DigestSignal[] = enriched.map((l, i) => {
    const intent = intentForScore(l.score) ?? 'low'
    return {
      contactId: l.contactId,
      name: [l.firstName, l.lastName].filter(Boolean).join(' ') || l.email || 'A contact',
      initials: makeInitials(l.firstName, l.lastName, l.email),
      suburb: l.suburb,
      timing: formatTiming(l.lastSeenAt),
      identity: 'known',
      // The lone top-of-roster high-intent lead leads "Act now"; the rest sit
      // in "Worth a look". Urgency-based tiering is refined in Phase 4.
      tier: i === 0 && intent === 'high' ? 'act-now' : 'worth-a-look',
      intent,
      newlyKnown: l.topEventType === 'form_submit' || l.topEventType === 'return_visit',
      insight: l.tags.length ? l.tags.join(' · ') : 'Active on your site recently.',
      read: l.nudge,
      // Firewall trust-line label (signal-card binds it to `pretext`, never
      // to `read`/`insight`). Present even when the draft was dropped — the
      // card-without-draft still renders honestly.
      pretext: l.pretext?.label,
      draft:   l.draft,
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
    attentionCount,
  }

  return <DigestView model={model} />
}

// ─── Demo dataset ────────────────────────────────────────────────────────────
// Content-true to the V2 prototype (digest-data.js). Exercises all four
// identity-state permutations + the firewall-safe drafts + the outcome loop,
// so we can verify the design on a preview without seeding real activity.
// Only renders when ?demo=1 (live week) or ?demo=quiet (ambient-only) — never
// served by default. THE FIREWALL: every `pretext` is a public/relationship
// hook; `insight` may name behaviour, `read` hands over the pretext only.

function demoModel(scenario: 'live' | 'quiet'): DigestViewModel {
  // Known — act-now. Near-submit, the genuine "call before Friday".
  const marcus: DigestSignal = {
    contactId: 'demo-marcus-bell',
    name: 'Marcus Bell',
    initials: 'MB',
    suburb: 'Glebe, NSW',
    timing: 'Active this morning',
    identity: 'known',
    tier: 'act-now',
    intent: 'high',
    insight: 'Started a contact form this morning and didn’t send it. Fourth visit this week.',
    read: 'He’s close — the kind of close that calls someone else by Friday if no one calls him first. A recent Glebe result is reason enough to land in his inbox today.',
    pretext: 'a recent Glebe sale',
    draft: {
      subject: 'A quick read on the Glebe market',
      body: 'Hi Marcus,\n\nA home just sold strongly a few streets from you in Glebe, and it’s stirred up genuine buyer interest in the area. If you’ve ever been curious what your place might do in this market, I’d be glad to put together a quick, no-obligation read.\n\nNo rush either way — reach out whenever suits.\n\nJames',
    },
    outcome: { steps: ['sent', 'opened', 'replied'], note: 'You spoke last autumn — he asked to stay in the loop.' },
  }

  // Known — worth a look. Circling the appraisal page; softened after a quiet thread.
  const sarah: DigestSignal = {
    contactId: 'demo-sarah-thompson',
    name: 'Sarah Thompson',
    initials: 'ST',
    suburb: 'Paddington, NSW',
    timing: 'Active 2h ago',
    identity: 'known',
    tier: 'worth-a-look',
    intent: 'high',
    insight: 'On the appraisal page twice this week — her third session in five days.',
    read: 'She’s circling, and she’s done this before. Worth a warm note — a recent Paddington sale gives you a reason to reach out.',
    pretext: 'a recent Paddington result',
    draft: {
      subject: 'What’s happening in Paddington right now',
      body: 'Hi Sarah,\n\nWe just wrapped a strong result on a Paddington terrace and there’s real momentum in the area at the moment. If a short market update would be useful, I’d happily pull one together for you.\n\nAlways here if you’d like to talk it through.\n\nJames',
    },
    outcome: { steps: ['sent', 'opened', 'quiet'], note: 'Your last note was opened twice, no reply — so I’ve softened today’s angle.' },
  }

  // Known — newly identified after a fortnight anonymous. The satisfying convert.
  const priya: DigestSignal = {
    contactId: 'demo-priya-raman',
    name: 'Priya Raman',
    initials: 'PR',
    suburb: 'Paddington, NSW',
    timing: 'Identified 12 min ago',
    identity: 'known',
    tier: 'worth-a-look',
    intent: 'high',
    newlyKnown: true,
    insight: '14 sessions over a fortnight, all anonymous — until she added her name 12 minutes ago.',
    read: 'A fortnight of quiet attention, and now she’s put her name to it. No rush — just a warm hello while she’s thinking about it.',
    pretext: 'a local introduction as her Paddington agent',
    draft: {
      subject: 'Hello from James — your Paddington local',
      body: 'Hi Priya,\n\nJames here — I look after a good part of the Paddington market and thought I’d introduce myself. If you’d ever like a relaxed, no-pressure sense of what local homes are doing, just say the word.\n\nLovely to be in touch.\n\nJames',
    },
    outcome: { steps: ['new'], note: 'First reach-out — I’ll track how it lands and shape the next one.' },
  }

  // Probable — device matches Tom at 0.78 (≥ 0.75 threshold). Confirm reveals the draft.
  const tom: DigestSignal = {
    contactId: 'demo-tom-obrien',
    name: 'Tom O’Brien',
    initials: 'TO',
    suburb: 'Balmain, NSW',
    timing: 'Active 1h ago',
    identity: 'probable',
    tier: 'worth-a-look',
    intent: 'mid',
    confidence: 0.78,
    insight: 'Five visits to the Balmain sold results this week. The device matches Tom O’Brien in your contacts.',
    read: 'Looks like Tom from Balmain — but I’m not certain enough to put words in your mouth. Confirm it’s him and I’ll have a note ready to go.',
    pretext: 'recent Balmain results',
    draft: {
      subject: 'The Balmain market, if it’s useful',
      body: 'Hi Tom,\n\nBalmain’s had a few notable results lately and the market’s moving in an interesting way. If you’d find a quick local update handy, I’m glad to send one through.\n\nNo obligation at all — just reach out whenever.\n\nJames',
    },
    outcome: { steps: ['new'], note: 'First reach-out — I’ll track how it lands.' },
  }

  // Anonymous — honest action is "watch closely", never an email.
  const anon: DigestSignal = {
    contactId: 'demo-anon-maple',
    name: 'Anonymous visitor',
    initials: null,
    suburb: 'Surry Hills, NSW',
    timing: 'Active 40 min ago',
    identity: 'anonymous',
    tier: 'worth-a-look',
    intent: 'mid',
    insight: 'Circled 12 Maple Street five times this week — same device, no name attached.',
    read: 'No name yet, but this one keeps coming back. Nothing to send — let me keep watching, and I’ll tell you the moment they surface.',
  }

  // Ambient — suburb-level, no individual. Suppressed on a busy day; the hero of a quiet one.
  const ambient: DigestSignal = {
    contactId: 'demo-ambient-paddington',
    name: 'Something’s stirring in Paddington',
    initials: null,
    suburb: 'Paddington, NSW',
    timing: 'This week',
    identity: 'ambient',
    tier: 'ambient',
    insight: 'Three new anonymous visitors started on Paddington listings this week. Nobody’s stepped forward yet.',
    read: 'Quiet week — nothing on your site needs you today. But three new vendors started circling Paddington. The ground’s shifting; I’ll tell you the moment it’s a person.',
  }

  const signals = scenario === 'quiet' ? [ambient] : [marcus, sarah, priya, tom, anon, ambient]

  return {
    dateLabel: new Date().toLocaleDateString('en-AU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
    sentAtLabel: scenario === 'quiet' ? '6:04 am' : '6:02 am',
    narrative:
      scenario === 'quiet'
        ? 'A genuinely quiet one — nothing on your site needs you today, and that’s alright. I’ve kept watch. The one thing worth knowing is the suburb itself starting to move.'
        : 'One to act on this morning, and a handful worth a look. Marcus got close to a contact form and could try someone else by Friday — start there. Sarah’s circling again, and someone I’d watched for a fortnight finally put her name to it.',
    signals,
    stats: { worthAttention: 4, highIntent: 2, newlyKnown: 1 },
    rail: demoRail(scenario),
    websiteUrl: 'https://jamesreid.com.au',
    isDemo: true,
  }
}

// "Your rhythm" intensity rail — 14 days ending today. Columns align between
// the two strips so signal visibly trails activity by ~a day. Content-true to
// the prototype (digest-data.js). Activity = coral, Signal = teal/moss; shaded
// by opacity (never a hex ramp). Today is the open dashed "+" on Activity.
const RAIL_DAYS = [
  'Sat 16', 'Sun 17', 'Mon 18', 'Tue 19', 'Wed 20', 'Thu 21', 'Fri 22',
  'Sat 23', 'Sun 24', 'Mon 25', 'Tue 26', 'Wed 27', 'Thu 28', 'Fri 29',
]

function demoRail(scenario: 'live' | 'quiet'): DigestRailData {
  if (scenario === 'quiet') {
    return {
      activityColor: '#C4622D',
      signalColor: '#3D5246',
      days: RAIL_DAYS,
      activity: [1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, null],
      signal: [1, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0],
      note: 'Slow stretch — no drama. One tracked send today is an easy way back on it.',
    }
  }
  return {
    activityColor: '#C4622D',
    signalColor: '#3D5246',
    days: RAIL_DAYS,
    // Thu 21 push (3) → Fri 22 signal (3); Thu 28 push (4) → Fri 29 still landing.
    activity: [0, 0, 1, 2, 1, 3, 1, 0, 0, 2, 1, 1, 4, null],
    signal: [1, 0, 0, 1, 2, 2, 3, 1, 0, 1, 2, 1, 2, 1],
    note: 'Thursday’s push is still landing as Friday signal. Today’s open — send one and watch it fill.',
  }
}

// Real-mode rail. The live activity/signal series (tracked sends from
// `email_sends`, returning signal from `events`) wires in Phases 2–4; until
// then render the empty 14-day frame with today's open cell so the rhythm
// surface is present and fills in as the agent acts.
function realRail(): DigestRailData {
  const days = Array.from({ length: 14 }, (_, k) => {
    const d = new Date()
    d.setDate(d.getDate() - (13 - k))
    return `${d.toLocaleDateString('en-AU', { weekday: 'short' })} ${d.getDate()}`
  })
  return {
    activityColor: '#C4622D',
    signalColor: '#3D5246',
    days,
    activity: [...Array(13).fill(null), null], // all empty; last = today's open cell
    signal: Array(14).fill(null),
    note: 'Your rhythm fills in here as your tracked sends — and the signal they bring back — start to land.',
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

// ─── AI insight caching (HOR-127) ────────────────────────────────────────────
// `unstable_cache` keys are content-addressable on values that change when
// the contact's status changes (score, score_change, last_seen_at). New
// activity invalidates the cache organically; repeat /digest loads inside a
// stable window hit cache and skip Anthropic.
//
// Tags are `digest:<agent_id>` so the daily-briefing cron can issue a
// single `revalidateTag('digest:' + agent_id)` to warm the next morning's
// roster after it sends.

interface InsightArgs {
  agentId: string
  agentName: string
  lead: {
    contact_id:   string
    first_name:   string | null
    last_name:    string | null
    email:        string | null
    score:        number
    score_change: number
    last_seen_at: string | null
  }
  events: ContactEvent[]
}

async function getCachedInsight(args: InsightArgs): Promise<ContactInsight> {
  const apiKey = process.env.ANTHROPIC_API_KEY!
  // Capture primitives so the cache key array is stable; the Anthropic
  // client is constructed lazily inside the cached function.
  const { agentId, agentName, lead, events } = args
  const cached = unstable_cache(
    async () => {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const anthropic = new Anthropic({ apiKey })
      return generateContactInsight(anthropic, agentName, lead, events)
    },
    [
      'digest-insight-v1',
      lead.contact_id,
      String(lead.score),
      String(lead.score_change ?? 0),
      lead.last_seen_at ?? '',
    ],
    { tags: [`digest:${agentId}`], revalidate: 86400 },
  )
  return cached()
}

interface NarrativeArgs {
  agentId: string
  agentName: string
  leads: Array<{
    contactId:    string
    first_name:   string | null
    last_name:    string | null
    score:        number
    score_change: number
    topEventType: string | null
  }>
}

async function getCachedNarrative(args: NarrativeArgs): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY!
  const { agentId, agentName, leads } = args
  // Stable hash across the ordered roster — same contacts + same top events
  // means same narrative.
  const rosterKey = leads
    .map((l) => `${l.contactId}:${l.score}:${l.topEventType ?? ''}`)
    .join('|')

  const cached = unstable_cache(
    async () => {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const anthropic = new Anthropic({ apiKey })
      return generateBriefingNarrative(
        anthropic,
        agentName,
        leads.map((l) => ({
          first_name:   l.first_name,
          last_name:    l.last_name,
          score:        l.score,
          score_change: l.score_change,
          topEventType: l.topEventType,
        })),
        'today',
      )
    },
    ['digest-narrative-v1', agentId, rosterKey],
    { tags: [`digest:${agentId}`], revalidate: 86400 },
  )
  return cached()
}
