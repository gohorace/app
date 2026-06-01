/**
 * Property "Horace's read" (HOR-349 / Property V2 PR2).
 *
 * Adapts the briefing.ts house pattern (`generateContactInsight`) to a
 * *property-anchored* read: given the PR1 `PropertySignal`, produce the
 * 1–2 sentence read that leads the property detail's SIGNAL zone, plus a
 * provenance line ("Built from 3 visits + an appraisal request this week")
 * and a freshness timestamp.
 *
 * House conventions (mirrors `signal-draft.ts`): `claude-haiku-4-5`, a single
 * `messages.create`, prompt-and-parse JSON, a deterministic template fallback
 * when AI is unavailable, and an `unstable_cache` wrapper keyed on the
 * property + a signal hash, tagged `digest:<agentId>` so the briefing cron's
 * `revalidateTag` warms it.
 *
 * This is an INTERNAL read (the agent's private view), not outreach copy — so
 * unlike `generateSignalDraft` it carries no firewall banned-phrase filter.
 * It may reason about on-site behaviour because it never leaves the app.
 */
import Anthropic from '@anthropic-ai/sdk'
import { unstable_cache } from 'next/cache'
import type { PropertySignal, CirclingContact } from '@/lib/properties/signal'

const MODEL = 'claude-haiku-4-5'

export interface PropertyRead {
  /** 1–2 sentence property-anchored read. */
  read: string
  /** Source attribution, e.g. "Built from 3 visits + an appraisal request this week". */
  provenance: string
  /** ISO of the most recent activity behind the read (drives "updated <ago>"). */
  updatedAt: string | null
}

// ── Pure derivations (provenance, freshness, cache key) ──────────────────────

/** Total known visits this week across the circling contacts. */
function weekVisits(circling: CirclingContact[]): number {
  return circling.reduce((sum, c) => sum + Math.max(0, c.delta), 0)
}

/** The strongest moment behind the read, if any (timeline is newest-first). */
function topMoment(signal: PropertySignal): { label: string; detail: string } | null {
  const m = signal.timeline.find((r) => r.kind === 'moment')
  return m && m.kind === 'moment' ? { label: m.label, detail: m.detail } : null
}

/**
 * One-line provenance — the same honesty as the contact read's "Built from…".
 * Names known weekly visits first, folds in the strongest moment, and falls
 * back to anonymous sessions when there are no attributed visits. Null-safe:
 * returns a quiet line when the property is cold.
 */
export function propertyReadProvenance(signal: PropertySignal): string {
  const visits = weekVisits(signal.circling)
  const moment = topMoment(signal)
  const momentPhrase = moment ? momentToPhrase(moment.label) : null

  let base: string
  if (visits > 0) {
    base = `Built from ${visits} visit${visits === 1 ? '' : 's'} this week`
  } else if (signal.anonSessions > 0) {
    base = `Built from ${signal.anonSessions} anonymous session${signal.anonSessions === 1 ? '' : 's'} this month`
  } else {
    return 'Quiet so far — nothing to build a read from yet'
  }
  return momentPhrase ? `${base} + ${momentPhrase}` : base
}

/** Turn a moment label into a lower-case provenance clause. */
function momentToPhrase(label: string): string {
  const l = label.toLowerCase()
  if (l.includes('appraisal')) return 'an appraisal request'
  if (l.includes('enquiry') || l.includes('enquired')) return 'a buyer enquiry'
  if (l.includes('form')) return 'a form submission'
  return l
}

/** Freshness — the most recent activity timestamp behind the read. */
export function propertyReadUpdatedAt(signal: PropertySignal): string | null {
  const newest = signal.timeline[0]?.occurredAt ?? null
  const hottest = signal.circling[0]?.lastSeen ?? null
  if (!newest) return hottest
  if (!hottest) return newest
  return newest > hottest ? newest : hottest
}

/**
 * A short, stable hash of the parts of the signal that should change the read.
 * Used as part of the cache key so new behaviour invalidates organically but a
 * stable window hits cache.
 */
export function signalReadHash(signal: PropertySignal): string {
  const hot = signal.circling[0]
  const moment = topMoment(signal)
  return [
    hot ? `${hot.contactId}:${Math.round(hot.pct * 20)}:${hot.delta}` : 'none',
    signal.knownCount,
    weekVisits(signal.circling),
    signal.anonSessions,
    moment ? momentToPhrase(moment.label) : 'no-moment',
  ].join('|')
}

// ── Deterministic fallback ───────────────────────────────────────────────────

/**
 * Template read used when ANTHROPIC_API_KEY is unset or the model errors.
 * Degrades gracefully and stays consistent with the chips/provenance — never
 * over-claims beyond what the signal carries.
 */
export function fallbackPropertyRead(signal: PropertySignal, address: string): string {
  const hot = signal.circling[0]
  const moment = topMoment(signal)
  const place = shortAddress(address)

  if (!hot && signal.anonSessions === 0) {
    return `Quiet on ${place} for now. Horace will surface it the moment someone starts circling.`
  }
  if (!hot) {
    return `${signal.anonSessions} anonymous session${signal.anonSessions === 1 ? '' : 's'} on ${place} this month — interest without a name attached yet.`
  }
  const visitClause =
    hot.delta > 0 ? `, back ${hot.delta}× this week` : ''
  const momentClause = moment ? ` ${hot.firstName} ${momentPastTense(moment.label)}.` : '.'
  return `${hot.name} is circling ${place}${visitClause} — ${hot.tier.toLowerCase()} interest${momentClause}`
}

function momentPastTense(label: string): string {
  const l = label.toLowerCase()
  if (l.includes('appraisal')) return 'requested an appraisal'
  if (l.includes('enquiry') || l.includes('enquired')) return 'sent a buyer enquiry'
  if (l.includes('form')) return 'submitted a form'
  return l
}

/** First line of an address (drop the trailing suburb/state for brevity). */
function shortAddress(address: string): string {
  const comma = address.indexOf(',')
  return comma === -1 ? address : address.slice(0, comma).trim()
}

// ── AI generation ─────────────────────────────────────────────────────────────

function buildPrompt(signal: PropertySignal, address: string, agentName: string): string {
  const agentFirst = agentName.split(' ')[0] || agentName
  const hot = signal.circling[0]
  const circlingLines = signal.circling
    .slice(0, 5)
    .map((c) => `- ${c.name} (${c.tier}, ${c.delta} visit${c.delta === 1 ? '' : 's'} this week): ${c.read}`)
    .join('\n')
  const moment = topMoment(signal)

  return `You are Horace — a quiet, perceptive real-estate market-intelligence companion writing a private read for an agent named ${agentFirst}. This is an INTERNAL note (never sent to anyone), so you may reason about on-site behaviour directly.

Property: ${address}
People circling${signal.circling.length ? ':' : ': none yet'}
${circlingLines || '- (no attributed contacts yet)'}
Anonymous sessions this month: ${signal.anonSessions}
${moment ? `Standout moment: ${moment.label} — ${moment.detail}` : 'No standout moment yet.'}

Write a "why now" read for this property in 1–2 sentences:
- Lead with the strongest signal — usually the hottest person${hot ? ` (${hot.name})` : ''} and what they did.
- Be specific and direct. No fluff, no greeting, no advice — just the read.
- If there's a standout moment, name it. If the property is quiet, say so plainly.

Respond in JSON only: {"read": "..."}`
}

/**
 * Generate the property read. Returns the deterministic fallback string on any
 * failure (empty/malformed reply, API error). Caller wraps in cache.
 */
export async function generatePropertyRead(
  client: Anthropic,
  agentName: string,
  signal: PropertySignal,
  address: string,
): Promise<string> {
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      messages: [{ role: 'user', content: buildPrompt(signal, address, agentName) }],
    })
    const raw = message.content[0]?.type === 'text' ? message.content[0].text : ''
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(stripped) as { read?: unknown }
    const read = typeof parsed.read === 'string' ? parsed.read.trim() : ''
    return read || fallbackPropertyRead(signal, address)
  } catch (err) {
    console.error('[ai:property-read] generation failed:', err)
    return fallbackPropertyRead(signal, address)
  }
}

// ── Cache wrapper ─────────────────────────────────────────────────────────────

export interface CachedPropertyReadArgs {
  agentId: string
  agentName: string
  propertyId: string
  propertyAddress: string
  signal: PropertySignal
}

/**
 * Cached property read. Provenance + freshness are always derived purely
 * (cheap, deterministic); only the read sentence is AI-generated and cached.
 * Keyed on the property id + a signal hash so new behaviour invalidates;
 * tagged `digest:<agentId>`. Falls back to the deterministic template when the
 * API key is unset.
 */
export async function getCachedPropertyRead(args: CachedPropertyReadArgs): Promise<PropertyRead> {
  const { agentId, agentName, propertyId, propertyAddress, signal } = args
  const provenance = propertyReadProvenance(signal)
  const updatedAt = propertyReadUpdatedAt(signal)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { read: fallbackPropertyRead(signal, propertyAddress), provenance, updatedAt }
  }

  const cached = unstable_cache(
    async () => {
      const client = new Anthropic({ apiKey })
      return generatePropertyRead(client, agentName, signal, propertyAddress)
    },
    ['property-read-v1', propertyId, signalReadHash(signal)],
    { tags: [`digest:${agentId}`], revalidate: 86400 },
  )
  return { read: await cached(), provenance, updatedAt }
}
