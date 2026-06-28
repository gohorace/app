import Anthropic from '@anthropic-ai/sdk'
import { unstable_cache } from 'next/cache'
import { intentForScore, INTENT_LABEL } from '@/lib/design/intent'

export interface ContactEvent {
  event_type: string
  properties: Record<string, unknown>
  score_delta: number
  occurred_at: string
}

export interface ContactInsight {
  why_now: string   // 1–2 sentences: what they did and why it matters
  action: string    // specific recommended action for the agent
}

export interface LeadWithInsight {
  contact_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  score: number
  score_change: number
  last_seen_at: string | null
  /** Resolved-identity timestamp; null = anonymous (activity, no name yet). */
  identified_at?: string | null
  insight: ContactInsight
}

/**
 * Generates a why_now + action insight for a single contact
 * based on their recent events. Returns a fallback if AI is unavailable.
 */
export async function generateContactInsight(
  client: Anthropic,
  agentName: string,
  contact: {
    contact_id?: string  // optional, used for stable fallback-variant selection
    first_name: string | null
    last_name: string | null
    email: string | null
    score: number
    score_change: number
    last_seen_at: string | null
  },
  recentEvents: ContactEvent[],
): Promise<ContactInsight> {
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email || 'this contact'
  const agentFirst = agentName.split(' ')[0] || agentName

  const eventLines = recentEvents
    .slice(0, 10)
    .map((e) => {
      const props = e.properties
      const detail =
        e.event_type === 'page_view'      ? `viewed page: ${props.path ?? props.url ?? ''}` :
        e.event_type === 'property_view'  ? `viewed property: ${props.address ?? props.property_id ?? ''}` :
        e.event_type === 'form_submit'    ? `submitted form: ${props.form_id ?? props.form_name ?? 'enquiry'}` :
        e.event_type === 'return_visit'   ? 'returned to the website' :
        e.event_type === 'scroll_depth'   ? `read ${props.pct ?? ''}% of a page` :
        e.event_type
      const when = new Date(e.occurred_at).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
      return `- ${when}: ${detail}`
    })
    .join('\n')

  const tier = intentForScore(contact.score)
  const signal = tier ? INTENT_LABEL[tier].toLowerCase() : 'quiet — no behaviour signal yet'
  const drift =
    contact.score_change > 0 ? 'behaviour is intensifying this week'
    : contact.score_change < 0 ? 'behaviour is cooling this week'
    : 'behaviour is steady this week'

  const prompt = `You are writing a concise intelligence brief for a real estate agent named ${agentFirst}.

Contact: ${name}${contact.email ? ` (${contact.email})` : ''}
Behaviour signal: ${signal} — ${drift}
Last seen: ${contact.last_seen_at ? new Date(contact.last_seen_at).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : 'unknown'}

Recent activity:
${eventLines || '- No recent events'}

Write two things:
1. why_now: 1–2 sentences explaining why this person deserves attention right now. Be specific about what they did. Be direct, no fluff. Never refer to a numeric score or points — describe the behaviour qualitatively.
2. action: one specific action ${agentFirst} should take — e.g. "Call ${name} today and ask if they're still thinking of selling." Be concrete.

Respond in JSON only:
{"why_now": "...", "action": "..."}`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text : ''
    const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(text) as { why_now: string; action: string }

    return {
      why_now: parsed.why_now ?? fallbackInsight(name, contact.contact_id).why_now,
      action:  parsed.action  ?? fallbackInsight(name, contact.contact_id).action,
    }
  } catch (err) {
    console.error(`[briefing-ai] Failed to generate insight for ${name}:`, err)
    return fallbackInsight(name, contact.contact_id)
  }
}

/**
 * Generates a short Horace-voiced narrative intro for the briefing email,
 * summarising the day's lead activity in 2–3 punchy sentences.
 */
export async function generateBriefingNarrative(
  client: Anthropic,
  agentName: string,
  leads: Array<{
    first_name: string | null
    last_name: string | null
    score: number
    score_change: number
    topEventType?: string | null
  }>,
  windowLabel: 'today' | 'this week',
): Promise<string> {
  if (leads.length === 0) {
    return `Quiet ${windowLabel}. Horace is watching.`
  }

  const agentFirst = agentName.split(' ')[0] || agentName
  const leadLines = leads.map((l) => {
    const name = [l.first_name, l.last_name].filter(Boolean).join(' ') || 'A contact'
    const event = l.topEventType === 'form_submit'
      ? 'submitted a form'
      : l.topEventType === 'return_visit'
        ? 'came back'
        : l.topEventType === 'property_view'
          ? 'viewed a listing'
          : 'was active'
    const tier = intentForScore(l.score)
    const signal = tier ? INTENT_LABEL[tier].toLowerCase() : 'quiet'
    return `${name} (${signal}, ${event})`
  }).join('; ')

  const prompt = `You are Horace — a quiet, intelligent real estate market intelligence system.
Write 2–3 sentences summarising ${windowLabel}'s lead activity for ${agentFirst}.

Leads ${windowLabel}: ${leadLines}

Rules:
- No greeting, no "Hi ${agentFirst}". Just the intelligence.
- Confident, brief, slightly poetic. Write like a trusted advisor, not a dashboard.
- Name the 1–2 most notable contacts and what they did.
- End with a sense of what the agent should do with this information.
- Under 60 words.
- Never refer to numeric scores or points — describe shifts qualitatively (intensifying, cooling, stirring, returning).

Example style: "Three contacts stirred today. Emma's been back twice — something's shifting. Tom raised his hand with a form. The moment is yours."

Respond with the narrative text only, no JSON, no quotes.`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 128,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    return text || fallbackNarrative(leads.length, windowLabel)
  } catch {
    return fallbackNarrative(leads.length, windowLabel)
  }
}

// ── Fallback copy (HOR-128) ──────────────────────────────────────────────────
// Used when ANTHROPIC_API_KEY is unset, Anthropic errors, or rate-limits us.
// Three variants per kind so the empty-AI case doesn't feel monotonous across
// a roster. Picked deterministically from a stable key (contact_id for
// per-contact insights, lead_count + window for the narrative) so the same
// contact gets the same fallback across reloads — no jarring re-shuffling.

const FALLBACK_WHY_NOW: ReadonlyArray<(name: string) => string> = [
  (name) => `${name} stirred on your site recently — the kind of return that often precedes a conversation.`,
  (name) => `Quiet signal from ${name} — they came back. Horace is watching to see what they linger on next.`,
  (name) => `${name} brushed past your site again. Worth a soft nudge before they move on.`,
]

const FALLBACK_ACTION: ReadonlyArray<(firstName: string) => string> = [
  (first) => `Drop ${first} a line — open with whatever they were last looking at.`,
  (first) => `Reach out to ${first} this week. Light touch, no pitch.`,
  (first) => `A short call with ${first} would tell you more than any guess could.`,
]

const FALLBACK_NARRATIVE: ReadonlyArray<(count: number, windowLabel: string) => string> = [
  (count, w) => `${count} contact${count === 1 ? '' : 's'} worth your attention ${w}. Horace has been watching.`,
  (count, w) => `Quiet ${w}, but ${count} ${count === 1 ? 'person' : 'people'} came around. Worth a closer look.`,
  (count, w) => `${count} familiar ${count === 1 ? 'face' : 'faces'} on the site ${w}. The moment's there if you want it.`,
]

/**
 * Stable, content-addressable pick across an array of variants. Keeps the
 * same contact on the same variant across reloads, but spreads variants
 * across a roster of contacts.
 */
function pickVariant<T>(variants: ReadonlyArray<T>, key: string): T {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) - hash) + key.charCodeAt(i)
  return variants[Math.abs(hash) % variants.length]
}

function fallbackInsight(name: string, contactId?: string): ContactInsight {
  const first = name.split(' ')[0] || name
  const key = contactId ?? name
  // Log once per fallback hit so a key-missing situation is visible in
  // Vercel logs. Grep target: '[ai:fallback]'.
  console.log('[ai:fallback] contact-insight', { name, key })
  return {
    why_now: pickVariant(FALLBACK_WHY_NOW, key)(name),
    action:  pickVariant(FALLBACK_ACTION,  key)(first),
  }
}

function fallbackNarrative(count: number, windowLabel: string): string {
  // Hash on the roster size + window so the same shape of morning gets a
  // consistent narrative — but two different mornings can land on different
  // variants. Predictable enough to not feel random, varied enough to not
  // feel canned.
  console.log('[ai:fallback] narrative', { count, windowLabel })
  const key = `${count}:${windowLabel}`
  return pickVariant(FALLBACK_NARRATIVE, key)(count, windowLabel)
}

// ─── Cached single-contact insight (HOR-127 / HOR-246) ───────────────────────
// Shared wrapper around `generateContactInsight`. The `/digest` roster and the
// contact-detail page both want the same cached `why_now` for a contact, keyed
// on the values that change when the contact's status changes (score,
// score_change, last_seen) so new activity invalidates organically. Tagged
// `digest:<agentId>` so the daily-briefing cron warms both surfaces at once.
//
// Best-effort: when `ANTHROPIC_API_KEY` is unset the Anthropic client never
// constructs and the deterministic fallback insight is returned instead.

export interface CachedInsightArgs {
  agentId: string
  agentName: string
  contact: {
    contact_id: string
    first_name: string | null
    last_name: string | null
    email: string | null
    score: number
    score_change: number
    last_seen_at: string | null
  }
  events: ContactEvent[]
}

export async function getCachedContactInsight(args: CachedInsightArgs): Promise<ContactInsight> {
  const { agentId, agentName, contact, events } = args
  const apiKey = process.env.ANTHROPIC_API_KEY
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email || 'this contact'
  if (!apiKey) return fallbackInsight(name, contact.contact_id)

  const cached = unstable_cache(
    async () => {
      const client = new Anthropic({ apiKey })
      return generateContactInsight(client, agentName, contact, events)
    },
    [
      'contact-insight-v1',
      contact.contact_id,
      String(contact.score),
      String(contact.score_change ?? 0),
      contact.last_seen_at ?? '',
    ],
    { tags: [`digest:${agentId}`], revalidate: 86400 },
  )
  return cached()
}
