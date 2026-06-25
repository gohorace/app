/**
 * Horace — Digest V2 firewall-safe signal drafts (HOR-338 / Phase 2).
 *
 * For each known contact on the /digest stream, this module:
 *
 *   1. Derives a TRUTHFUL pretext (a public or relationship hook the
 *      agent can plausibly act on) — never site behaviour.
 *   2. Asks Haiku to write a short outbound draft grounded in that
 *      pretext alone, validated against a banned-phrase list.
 *
 * THE FIREWALL (digest plan §5, hard rule): what the contact did on the
 * agent's site is the agent's secret to act on, never the email's
 * justification. The draft's "Reasoned from {pretext}" trust line in
 * signal-card.tsx is bound to `pretext`, never to `read` / `insight` —
 * this module is what makes that line truthful.
 *
 * Pretext source order (first hit wins):
 *   1. `recent-sold`        — a sold property in the contact's suburb in the
 *                             last 90 days (queries `properties` directly).
 *   2. `prior-relationship` — at least one tracked email already sent to
 *                             this contact (`email_sends` history).
 *   3. `local-intro`        — generic suburb intro. Always succeeds, so a
 *                             known contact always has a pretext; whether it
 *                             survives into a *draft* depends on the model
 *                             clearing the banned-phrase check.
 *
 * If the model can't produce a clean draft after two attempts (a
 * banned phrase survives even the corrective nudge), we drop the
 * draft for that contact — the card renders as informational rather
 * than landing a contaminated email.
 *
 * Mirrors the briefing.ts house pattern: `claude-haiku-4-5`,
 * single-shot `messages.create`, prompt-and-parse JSON, deterministic
 * skip (returns null) when the API key is unset.
 */

import Anthropic from '@anthropic-ai/sdk'
import { unstable_cache } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { getContactEmailSends } from '@/lib/contacts/email-engagement'

type AdminClient = SupabaseClient<Database>

const MODEL = 'claude-haiku-4-5'

// ── Public contract ─────────────────────────────────────────────────────────

export type PretextSource = 'recent-sold' | 'prior-relationship' | 'local-intro'

export interface SignalPretext {
  /** Short, public-facing label rendered on the card's trust line
   *  ("Reasoned from {label} — not from anything {first} did on your site"). */
  label: string
  /** Which class of source produced it. Drives telemetry + the model nudge. */
  source: PretextSource
  /** Optional concrete detail the prompt can reference (e.g. a sold address).
   *  Not surfaced on the card. */
  detail?: string
}

export interface SignalDraft {
  subject: string
  body: string
}

/** The agent's configured voice + signature (agent_settings). When supplied,
 *  the draft is written in `brand_voice` and a sign-off is suppressed in
 *  favour of the agent's stored signature (HOR-356 follow-up).
 *
 *  Signature shape:
 *  - `email_signature_html` is the rich-text editor's HTML (HOR-xxx). When set
 *    it's authoritative — we suppress the plain-text append here and let the
 *    send wire (signal-card.tsx) splice the styled HTML onto body_html.
 *  - `email_signature` is the plain-text fallback (also derived from html on
 *    save). When html is NOT set, this gets appended verbatim to the body so
 *    legacy plain-text-only consumers keep producing signatures unchanged. */
export interface AgentVoice {
  brand_voice: string | null
  email_signature: string | null
  email_signature_html?: string | null
}

/** A sold property used as a pretext source, returned by the bulk lookup. */
export interface RecentSoldHit {
  street_number: string | null
  street_name: string | null
  suburb: string | null
  last_activity_at: string | null
}

/** A sold property the agent can swap into the active sold row of the
 *  composer's Insight & Content panel. Includes the id so the dock can
 *  find-replace the address in the email + SMS body on swap.
 *
 *  Price is read out of the row's jsonb `metadata` (key `price`, when
 *  present); the `properties` table itself has no top-level price column. */
export interface SoldAlt {
  id: string
  street_number: string | null
  street_name: string | null
  suburb: string | null
  /** Extracted from `metadata->>price` when the row has one; null otherwise.
   *  Most G-NAF-sourced rows have empty metadata, so this is usually null. */
  price: number | null
  last_activity_at: string | null
}

/**
 * Resolve the workspace id for an agent. `properties` is scoped by
 * `workspace_id`, not `agent_id` — without this hop the sold-property fetchers
 * silently return [] (which was the case for `fetchRecentSoldBySuburb` until
 * this fix landed).
 */
async function workspaceIdForAgent(admin: AdminClient, agentId: string): Promise<string | null> {
  const { data } = await admin
    .from('agents')
    .select('workspace_id')
    .eq('id', agentId)
    .maybeSingle()
  return data?.workspace_id ?? null
}

// ── 1. Pretext sourcing ─────────────────────────────────────────────────────

/**
 * Bulk-fetch one recent-sold property per suburb so the per-contact
 * `derivePretext` call is a cheap Map lookup, not an N+1.
 *
 * Returns a map keyed by suburb → the freshest sold hit, or empty when no
 * suburbs were passed. The query is workspace-scoped via `workspace_id`
 * (resolved internally from `agentId`).
 */
export async function fetchRecentSoldBySuburb(
  admin: AdminClient,
  agentId: string,
  suburbs: ReadonlyArray<string | null>,
  windowDays = 90,
): Promise<Map<string, RecentSoldHit>> {
  const wanted = [...new Set(suburbs.filter((s): s is string => Boolean(s)))]
  if (wanted.length === 0) return new Map()

  const workspaceId = await workspaceIdForAgent(admin, agentId)
  if (!workspaceId) return new Map()

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('properties' as any)
    .select('street_number, street_name, suburb, last_activity_at')
    .eq('workspace_id', workspaceId)
    .eq('status', 'sold')
    .in('suburb', wanted)
    .gte('last_activity_at', since)
    .order('last_activity_at', { ascending: false })

  const out = new Map<string, RecentSoldHit>()
  for (const row of (data ?? []) as RecentSoldHit[]) {
    if (row.suburb && !out.has(row.suburb)) out.set(row.suburb, row)
  }
  return out
}

/**
 * Fetch up to `limit` recent-sold properties in a single suburb so the
 * composer's swap popover (Outreach Review re-skin) has alternatives the
 * agent can substitute into the draft. Returns an empty array when the
 * suburb is null/empty or nothing has sold in the window.
 *
 * Workspace-scoped via `workspace_id` (resolved internally from `agentId`).
 * Ordered by recency. `price` is pulled out of jsonb `metadata` and may be
 * null for G-NAF-sourced rows that ship without one.
 */
export async function fetchSoldAlts(
  admin: AdminClient,
  agentId: string,
  suburb: string | null,
  limit = 5,
  windowDays = 90,
): Promise<SoldAlt[]> {
  if (!suburb) return []
  const workspaceId = await workspaceIdForAgent(admin, agentId)
  if (!workspaceId) return []

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('properties' as any)
    .select('id, street_number, street_name, suburb, metadata, last_activity_at')
    .eq('workspace_id', workspaceId)
    .eq('status', 'sold')
    .eq('suburb', suburb)
    .gte('last_activity_at', since)
    .order('last_activity_at', { ascending: false })
    .limit(limit)

  return ((data ?? []) as Array<Omit<SoldAlt, 'price'> & { metadata: Record<string, unknown> | null }>).map((row) => ({
    id: row.id,
    street_number: row.street_number,
    street_name: row.street_name,
    suburb: row.suburb,
    price: extractPriceFromMetadata(row.metadata),
    last_activity_at: row.last_activity_at,
  }))
}

function extractPriceFromMetadata(metadata: Record<string, unknown> | null | undefined): number | null {
  if (!metadata) return null
  const raw = metadata.price ?? metadata.sale_price ?? metadata.sold_price
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[^\d.]/g, '')
    const n = Number.parseFloat(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Derive a truthful pretext for one contact, given the pre-fetched sold map.
 * Always returns a pretext — `local-intro` is the universal fallback so the
 * card has *something* to render the trust line against; whether that pretext
 * survives into a generated draft is up to `generateSignalDraft` + the
 * banned-phrase check.
 */
export async function derivePretext(
  admin: AdminClient,
  agentId: string,
  contact: { id: string; suburb: string | null },
  soldBySuburb: Map<string, RecentSoldHit>,
): Promise<SignalPretext> {
  // 1) Recent sold in the contact's suburb.
  if (contact.suburb) {
    const hit = soldBySuburb.get(contact.suburb)
    if (hit) {
      const addr = [hit.street_number, hit.street_name].filter(Boolean).join(' ').trim()
      return {
        label: `a recent ${contact.suburb} sale`,
        source: 'recent-sold',
        detail: addr ? `${addr}, ${contact.suburb}` : `a home in ${contact.suburb}`,
      }
    }
  }
  // 2) Prior email relationship — any tracked send to this contact counts.
  const sends = await getContactEmailSends(admin, agentId, contact.id)
  if (sends.length > 0) {
    return { label: 'our recent correspondence', source: 'prior-relationship' }
  }
  // 3) Local-intro fallback. Always succeeds.
  return {
    label: contact.suburb
      ? `a local introduction as your ${contact.suburb} agent`
      : 'a local introduction',
    source: 'local-intro',
  }
}

// ── 2. Banned-phrase firewall ───────────────────────────────────────────────

/**
 * Phrases that imply the contact was tracked. The model MUST NOT write any
 * of these in a draft subject or body. A hit triggers one corrective retry;
 * a second hit drops the draft (§5 — "no truthful draft, no draft at all").
 */
const BANNED_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\bI\s+saw\b/i,                   label: 'I saw' },
  { re: /\bI\s+noticed\b/i,               label: 'I noticed' },
  { re: /\byou\s+viewed\b/i,              label: 'you viewed' },
  { re: /\byou(?:'|’|\s+ha)?ve\s+been\s+looking\b/i, label: "you've been looking" },
  { re: /\byour\s+recent\s+visits?\b/i,   label: 'your recent visits' },
  { re: /\bbrowsing\b/i,                  label: 'browsing' },
  { re: /\bon\s+our\s+site\b/i,           label: 'on our site' },
  { re: /\byour\s+activity\b/i,           label: 'your activity' },
  { re: /\bwhile\s+(?:you\s+were\s+)?on\s+the\s+website\b/i, label: 'on the website' },
]

/** Returns the first banned phrase found, or null when the text is clean. */
export function findBannedPhrase(text: string): string | null {
  for (const { re, label } of BANNED_PATTERNS) if (re.test(text)) return label
  return null
}

/** Tiny stable string hash for cache keys (not security-sensitive). */
function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

// ── 3. Draft generation ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Horace — a quiet, perceptive companion writing on behalf of a real-estate agent. You compose outbound emails to the agent's contacts. Voice: warm, brief, slightly understated, never salesy. No emoji. No exclamation marks. Use em-dashes for rhythm.

THE FIREWALL — hard rule, applies to every draft:
- What the contact did on the agent's website is PRIVATE to the agent. Your draft must NEVER reveal or imply it. The contact must not be able to tell they were ever tracked.
- Lean ONLY on the public / relationship hook in the PRETEXT block. That is your single justification for writing.
- BANNED phrases — never write any of these, in any wording: "I saw", "I noticed", "you viewed", "you've been looking", "your recent visits", "browsing", "on our site", "your activity", "while you were on the website".
- The subject must be specific to the pretext (not generic "Following up" / "Touching base"). Maximum 60 characters.
- The body is at most two short paragraphs and ends with the agent's first name on its own line. Maximum 80 words of body.

You will receive a CONTACT block and a single PRETEXT block. Respond with ONLY a JSON object — no markdown, no code fences, no prose:

{"subject": "...", "body": "..."}`

function buildUserBlock(
  contact: { first_name: string | null; last_name: string | null; email: string | null },
  agentName: string,
  pretext: SignalPretext,
  retryNudge: string | null,
  voice?: AgentVoice,
): string {
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email || 'there'
  const first = contact.first_name?.trim() || name.split(' ')[0] || ''
  const agentFirst = agentName.split(' ')[0] || agentName

  // When the agent has configured a brand voice, write in it. When they've
  // configured a signature (either rich-text or legacy plain-text), we
  // append/splice it after generation — so the model must NOT write its
  // own sign-off (avoids a double signature).
  const hasSignature = !!voice?.email_signature_html || !!voice?.email_signature
  const signOffInstruction = hasSignature
    ? 'Do NOT write any sign-off or signature — the agent\'s signature is appended automatically.'
    : `Sign off with the agent's first name (${agentFirst}) on its own line.`

  return [
    voice?.brand_voice
      ? `VOICE — this OVERRIDES the default tone. Write the email in this voice, exactly as described (the firewall + length rules still apply):\n${voice.brand_voice}\n`
      : '',
    'CONTACT:',
    `- name: ${name}`,
    `- address by first name: ${first || '(use a polite generic opener)'}`,
    hasSignature ? '' : `- agent's first name (sign-off): ${agentFirst}`,
    '',
    'PRETEXT — your ONLY justification for writing:',
    `- label: ${pretext.label}`,
    pretext.detail ? `- you may reference this concrete detail: ${pretext.detail}` : '',
    `- source: ${pretext.source}`,
    '',
    `Write the draft now. Subject ≤ 60 chars, specific to the pretext. ${signOffInstruction} Respond with JSON only.`,
    retryNudge ?? '',
  ]
    .filter((line) => line !== null && line !== '')
    .join('\n')
}

/**
 * Generate one firewall-safe draft. Returns `null` when:
 *   - the model errored,
 *   - the JSON didn't parse to a `{subject, body}` shape, or
 *   - both attempts produced banned phrasing (the firewall held).
 *
 * Caller is responsible for `unstable_cache` wrapping — see
 * `getCachedSignalDraft`.
 */
export async function generateSignalDraft(
  client: Anthropic,
  agentName: string,
  contact: { first_name: string | null; last_name: string | null; email: string | null },
  pretext: SignalPretext,
  voice?: AgentVoice,
): Promise<SignalDraft | null> {
  let nudge: string | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 480,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: buildUserBlock(contact, agentName, pretext, nudge, voice) }],
      })
      const raw = message.content[0]?.type === 'text' ? message.content[0].text : ''
      const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      const parsed = JSON.parse(stripped) as { subject?: unknown; body?: unknown }
      const subject = typeof parsed.subject === 'string' ? parsed.subject.trim() : ''
      let body = typeof parsed.body === 'string' ? parsed.body.trim() : ''
      if (!subject || !body) {
        nudge = '\nYour previous reply was empty or malformed. Return JSON with both "subject" and "body" populated.'
        continue
      }
      // The firewall checks the model's own words — run it BEFORE appending the
      // agent's verbatim signature (which is trusted, agent-authored text).
      const violation = findBannedPhrase(subject) ?? findBannedPhrase(body)
      if (violation) {
        nudge = `\nYour previous draft used "${violation}", which violates the firewall. Rewrite without that phrasing — lean on the PRETEXT only and never imply the contact was tracked.`
        continue
      }
      // Plain-text append for legacy consumers (composer dock V2/V3, draft
      // outreach, MCP) — these can't render HTML signatures, so the plain-text
      // fallback gets concatenated here. When an HTML signature is configured,
      // we suppress this append and let the send wire splice the styled block
      // onto body_html (avoids a double signature in the rendered email).
      if (voice?.email_signature && !voice?.email_signature_html) {
        body = `${body}\n\n${voice.email_signature}`
      }
      return { subject, body }
    } catch (err) {
      console.error('[ai:signal-draft] generation failed:', err)
      return null
    }
  }
  // Two strikes — drop the draft. The card stays informational (§5).
  console.warn('[ai:signal-draft] firewall held — no draft after retry.')
  return null
}

// ── 4. Cache wrapper ────────────────────────────────────────────────────────

export interface CachedDraftArgs {
  agentId: string
  agentName: string
  contact: {
    contact_id: string
    first_name: string | null
    last_name: string | null
    email: string | null
  }
  pretext: SignalPretext
  /** Optional agent voice + signature (agent_settings). Part of the cache key
   *  so a profile edit busts stale drafts. */
  voice?: AgentVoice
}

/**
 * Wrap `generateSignalDraft` in `unstable_cache` keyed on the contact id +
 * the pretext (source + label). New pretext → new draft; same pretext +
 * contact → cache hit. Tagged `digest:<agentId>` so the daily-briefing
 * cron's `revalidateTag` warms drafts alongside insights.
 *
 * Returns `null` when the API key is unset, the model dropped the draft,
 * or the call failed — the live transform should then omit `draft` and
 * render the card as informational.
 */
export async function getCachedSignalDraft(args: CachedDraftArgs): Promise<SignalDraft | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  const { agentId, agentName, contact, pretext, voice } = args

  // Fingerprint the voice so a brand-voice/signature edit busts the cache.
  // Includes html length so swapping in a fresh signature reflows drafts.
  const voiceKey = voice
    ? `${(voice.brand_voice ?? '').length}:${(voice.email_signature ?? '').length}:${(voice.email_signature_html ?? '').length}:${djb2(`${voice.brand_voice ?? ''}|${voice.email_signature ?? ''}|${voice.email_signature_html ?? ''}`)}`
    : 'novoice'

  const cached = unstable_cache(
    async () => {
      const client = new Anthropic({ apiKey })
      return generateSignalDraft(client, agentName, contact, pretext, voice)
    },
    [
      'digest-signal-draft-v1',
      contact.contact_id,
      pretext.source,
      pretext.label,
      voiceKey,
    ],
    { tags: [`digest:${agentId}`], revalidate: 86400 },
  )
  return cached()
}
