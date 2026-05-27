/**
 * Horace companion — server-side conversation brain (HOR-271).
 *
 * Replaces the pattern-matched mock in `lib/companion/respond.ts`. The
 * approach is retrieve-then-generate:
 *
 *   1. Pull a small, workspace-scoped slice of real data (contacts that
 *      match the question, the agent's lists, recent activity for the
 *      focus contact).
 *   2. Pack it into one prompt and ask Haiku for a single JSON reply.
 *   3. Validate the reply against the retrieved data so every link and
 *      action id is real — the model can shape the answer but cannot
 *      invent a contact, list, or id that wasn't provided.
 *
 * Mirrors the house pattern in `lib/ai/briefing.ts`: Haiku, single-shot
 * `messages.create`, prompt-and-parse (SDK 0.85 predates structured
 * outputs), deterministic fallback when the API key is unset or the call
 * fails. The grounding step is what makes the emitted actions usable by
 * HOR-272 — `contactId` / `listId` are guaranteed to exist.
 *
 * Model is `claude-haiku-4-5` to match the other AI surfaces (briefings,
 * map summary) — right cost/latency for a high-frequency chat surface.
 * Swap to `claude-sonnet-4-6` here if grounding discipline or answer
 * quality needs more headroom.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { CompanionAction, ConversationTurn, HoraceMessage, MessageReference } from '@/lib/companion/types'
import { getContactEmailSends, type EmailSendSummary } from '@/lib/contacts/email-engagement'

type AdminClient = SupabaseClient<Database>

const MODEL = 'claude-haiku-4-5'

// ── Grounding ─────────────────────────────────────────────────────────────────

export interface GroundingContact {
  id: string
  name: string
  email: string | null
  score: number
  lastSeen: string | null
}

export interface GroundingList {
  id: string
  name: string
}

export interface Grounding {
  contacts: GroundingContact[]
  lists: GroundingList[]
  /** Pre-formatted recent-activity lines for the focus contact (contacts[0]). */
  events: string[]
  /** Recent email sends for the focus contact (contacts[0]), newest first and
   *  capped. Powers "did they open / click my email?" — HOR-306. */
  emailEngagement: EmailSendSummary[]
  contextLabel: string | undefined
}

/** Names worth searching the contact book for: the open context entity plus
 *  any capitalised words in the prompt (likely a person the agent named). */
export function extractSearchTerms(prompt: string, contextLabel: string | undefined): string[] {
  const terms = new Set<string>()
  const ctx = contextLabel?.match(/^(?:Contact|Property):\s*(.+)$/)
  if (ctx) terms.add(ctx[1].trim())
  for (const word of prompt.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? []) terms.add(word)
  return [...terms]
}

function contactName(c: { first_name: string | null; last_name: string | null; email: string | null }): string {
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'A contact'
}

function formatEvents(rows: unknown[]): string[] {
  return rows.slice(0, 8).map((row) => {
    const e = row as Record<string, unknown>
    const props = (e.properties ?? {}) as Record<string, unknown>
    const type = String(e.event_type ?? 'activity')
    const detail =
      type === 'page_view' ? `viewed ${props.path ?? props.url ?? 'a page'}` :
      type === 'property_view' ? `viewed property ${props.address ?? props.property_id ?? ''}`.trim() :
      type === 'form_submit' ? `submitted ${props.form_id ?? props.form_name ?? 'a form'}` :
      type === 'return_visit' ? 'returned to the site' :
      type === 'scroll_depth' ? `read ${props.pct ?? ''}% of a page` :
      type
    const when = e.occurred_at
      ? new Date(String(e.occurred_at)).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
      : ''
    return `- ${when ? `${when}: ` : ''}${detail}`
  })
}

/** One terse line per email send for the grounding block. Zero-count clauses
 *  are dropped so the model never reads "opened 0×" as a signal; for a tracked
 *  send with no opens we say so plainly (lets Horace answer "not yet"), and an
 *  untracked send reports "not tracked" rather than implying silence == unread. */
function formatEmailSend(s: EmailSendSummary): string {
  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''
  const parts: string[] = [`"${s.subject?.trim() || '(no subject)'}"`]
  parts.push(s.sent_at ? `sent ${fmt(s.sent_at)}` : 'not sent yet')
  if (s.status !== 'sent') parts.push(s.status.replace(/_/g, ' '))
  if (!s.tracked) {
    parts.push('not tracked')
  } else {
    parts.push(
      s.open_count > 0
        ? `opened ${s.open_count}×${s.first_opened_at ? ` (first ${fmt(s.first_opened_at)})` : ''}`
        : 'not opened yet',
    )
    if (s.click_count > 0) {
      parts.push(`clicked ${s.click_count}×${s.first_clicked_at ? ` (first ${fmt(s.first_clicked_at)})` : ''}`)
    }
  }
  return parts.join(' · ')
}

/** Workspace-scoped retrieval. Always returns *some* real contacts (falls back
 *  to top-by-score) so the model has grounded entities to reference rather
 *  than reaching for invented ones. */
export async function retrieveGrounding(
  supabase: AdminClient,
  agentId: string,
  workspaceId: string,
  prompt: string,
  contextLabel: string | undefined,
): Promise<Grounding> {
  const cols = 'id, first_name, last_name, email, score, last_seen_at'
  const terms = extractSearchTerms(prompt, contextLabel)

  let rows: Array<Record<string, unknown>> = []
  if (terms.length > 0) {
    const ors = terms
      .flatMap((t) => {
        const p = `%${t.replace(/[%,\\]/g, (c) => '\\' + c)}%`
        return [`first_name.ilike.${p}`, `last_name.ilike.${p}`, `email.ilike.${p}`]
      })
      .join(',')
    const { data } = await supabase
      .from('contacts')
      .select(cols)
      .eq('agent_id', agentId)
      .or(ors)
      .order('score', { ascending: false, nullsFirst: false })
      .limit(6)
    rows = (data ?? []) as Array<Record<string, unknown>>
  }
  if (rows.length === 0) {
    const { data } = await supabase
      .from('contacts')
      .select(cols)
      .eq('agent_id', agentId)
      .order('score', { ascending: false, nullsFirst: false })
      .limit(8)
    rows = (data ?? []) as Array<Record<string, unknown>>
  }

  const contacts: GroundingContact[] = rows.map((c) => ({
    id: String(c.id),
    name: contactName(c as never),
    email: (c.email as string | null) ?? null,
    score: Number(c.score ?? 0),
    lastSeen: (c.last_seen_at as string | null) ?? null,
  }))

  const { data: listRows } = await supabase
    .from('lists')
    .select('id, name')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(30)
  const lists: GroundingList[] = ((listRows ?? []) as Array<Record<string, unknown>>).map((l) => ({
    id: String(l.id),
    name: String(l.name ?? 'Untitled list'),
  }))

  let events: string[] = []
  let emailEngagement: EmailSendSummary[] = []
  if (contacts[0]) {
    const { data: ev } = await supabase.rpc('get_contact_events', { p_contact_id: contacts[0].id })
    events = formatEvents((ev ?? []) as unknown[])
    // Focus contact only — one extra query, no N+1. Reuses the HOR-228 loader
    // so the companion and the contact detail view tell the same story.
    emailEngagement = (await getContactEmailSends(supabase, agentId, contacts[0].id)).slice(0, 5)
  }

  return { contacts, lists, events, emailEngagement, contextLabel }
}

// ── Prompt ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Horace — a quiet, perceptive real-estate market-intelligence companion for a single agent. You speak directly to the agent in the first person ("I"), refer to their contacts and prospects in the third person, and read the data like a trusted advisor, not a dashboard.

Voice: confident, brief, slightly poetic. No emoji. No exclamation marks. Use em dashes for rhythm. Keep the main reply under 80 words.

You are given a slice of the agent's real data (CONTACTS, LISTS, RECENT ACTIVITY, and — when the focus contact has been emailed — EMAIL ENGAGEMENT). You must respond with ONLY a single JSON object — no markdown, no code fences, no prose around it — in this exact shape:

{
  "text": string,                  // your reply to the agent
  "italics"?: string,              // optional — one follow-on nudge sentence, the quiet "what I'd do" line
  "references"?: [{ "label": string, "route": string }],  // up to 3 links; "route" MUST be one of the /contacts/<id> or /lists/<id> values derived from the data below
  "action"?: <one action object>  // optional — include at most one, only when the agent asks for it or it is the obvious next step
}

Action objects (choose at most one):
- { "kind": "draft-email", "target": <contact's name>, "subject": string, "body": string, "contactId": <id from CONTACTS> }
- { "kind": "add-to-list", "target": <contact's name>, "listName": <a name from LISTS>, "contactId": <id from CONTACTS>, "listId": <id from LISTS> }
- { "kind": "create-inspection", "target": <address>, "when": <human-readable time>, "token": <kebab-case slug> }
- { "kind": "dismiss", "target": <what to dismiss> }

You may be mid-conversation. CONVERSATION SO FAR (when present) shows the prior turns — read it for continuity and don't re-ask what the agent already told you.

Hard rules:
- Never invent a CONTACT, LIST, email address, route, or id that is not present in the data below. If the data doesn't contain who the agent asked about, say so plainly — do not fabricate a person or a link.
- Only reference contacts/lists by the exact id given. Links use /contacts/<id> or /lists/<id> with those ids.
- Facts the agent states in the conversation (e.g. a recent sale price, how they met a contact, a property detail) ARE usable — draft with them and treat them as true. The "never invent" rule is about entities and links, not about facts the agent volunteers. You don't need a record of a sale to use one the agent just told you about.
- When EMAIL ENGAGEMENT is present you CAN and should answer whether your emails to that contact were opened or clicked — cite the specific counts and dates shown. When it is absent for the person asked about, say there's no tracked email to them yet rather than implying an open or click that isn't in the data.
- Email opens are an imperfect signal — mail apps and security scanners can load the tracking pixel without a human reading anything. Say a message was "opened", never "read", and treat a click as the stronger, more reliable sign of genuine interest. Don't over-claim opens.
- You are a thinking partner and signal reader, not a CRM. Do not invent tasks, deal stages, or follow-up reminders.
- Answer open-ended and casual questions ("what can you help me with?", "help me think about Brian") naturally — but ALWAYS through the JSON envelope, with your reply in "text". Never respond with bare prose outside the JSON.`

export function buildGroundingBlock(g: Grounding, prompt: string, history: ConversationTurn[] = []): string {
  const lines: string[] = []
  lines.push(`CONTEXT: ${g.contextLabel ?? 'Digest'}`)
  lines.push('')
  if (g.contacts.length > 0) {
    lines.push('CONTACTS (reference only these; use the exact id):')
    for (const c of g.contacts) {
      const seen = c.lastSeen
        ? new Date(c.lastSeen).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
        : 'not seen yet'
      lines.push(`- ${c.name}${c.email ? ` (${c.email})` : ''} · score ${c.score} · last seen ${seen} · id=${c.id}`)
    }
  } else {
    lines.push('CONTACTS: none on file yet.')
  }
  lines.push('')
  if (g.lists.length > 0) {
    lines.push('LISTS (use the exact id for add-to-list and links):')
    for (const l of g.lists) lines.push(`- ${l.name} · id=${l.id}`)
  } else {
    lines.push('LISTS: none yet.')
  }
  if (g.events.length > 0) {
    lines.push('')
    lines.push(`RECENT ACTIVITY for ${g.contacts[0]?.name ?? 'the focus contact'}:`)
    lines.push(...g.events)
  }
  if (g.emailEngagement.length > 0) {
    lines.push('')
    lines.push(`EMAIL ENGAGEMENT for ${g.contacts[0]?.name ?? 'the focus contact'} (newest first):`)
    for (const s of g.emailEngagement) lines.push(`- ${formatEmailSend(s)}`)
  }
  if (history.length > 0) {
    lines.push('')
    lines.push('CONVERSATION SO FAR (oldest first):')
    for (const turn of history) {
      lines.push(`${turn.role === 'agent' ? 'Agent' : 'Horace'}: ${turn.text}`)
    }
  }
  lines.push('')
  lines.push(`The agent's latest message: ${prompt}`)
  return lines.join('\n')
}

// ── Parse + ground ────────────────────────────────────────────────────────────

interface RawReply {
  text?: unknown
  italics?: unknown
  references?: unknown
  action?: unknown
}

/**
 * Tolerant parse. Haiku reliably returns the JSON envelope for specific
 * prompts, but for open-ended / casual ones ("what can you help me with?")
 * it often just answers in prose. Rather than throw that good answer away and
 * fall back to canned copy, we degrade gracefully:
 *   1. strict JSON,
 *   2. JSON object embedded in surrounding prose,
 *   3. the prose itself as the reply text (no references/action — we don't
 *      trust links/ids that never came through the structured envelope).
 * Only genuinely empty or broken-JSON-fragment output throws → fallback.
 */
export function parseReply(raw: string): RawReply {
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  const tryParse = (s: string): RawReply | null => {
    try {
      const parsed = JSON.parse(s) as RawReply
      return typeof parsed.text === 'string' && parsed.text.trim() ? parsed : null
    } catch {
      return null
    }
  }

  // 1. Whole thing is JSON.
  const direct = tryParse(stripped)
  if (direct) return direct

  // 2. A JSON object sits inside surrounding prose.
  const match = stripped.match(/\{[\s\S]*\}/)
  if (match) {
    const embedded = tryParse(match[0])
    if (embedded) return embedded
  }

  // 3. Plain conversational answer — render it as-is. Skip anything that looks
  //    like a broken/truncated JSON fragment (starts with '{') rather than show
  //    raw braces to the agent.
  if (stripped.length > 0 && !stripped.startsWith('{')) {
    return { text: stripped }
  }

  throw new Error('unparseable reply')
}

/** Drop anything the model invented: references whose route isn't in the
 *  grounded set, and action ids that don't exist. Returns a clean
 *  HoraceMessage with only real links and ids. */
export function groundReply(parsed: RawReply, g: Grounding): HoraceMessage {
  const contactIds = new Set(g.contacts.map((c) => c.id))
  const listIds = new Set(g.lists.map((l) => l.id))
  const allowedRoutes = new Set<string>([
    ...g.contacts.map((c) => `/contacts/${c.id}`),
    ...g.lists.map((l) => `/lists/${l.id}`),
  ])

  const message: HoraceMessage = { kind: 'horace', text: String(parsed.text).trim() }

  if (typeof parsed.italics === 'string' && parsed.italics.trim()) {
    message.italics = parsed.italics.trim()
  }

  if (Array.isArray(parsed.references)) {
    const refs: MessageReference[] = []
    for (const r of parsed.references) {
      if (
        r && typeof r === 'object' &&
        typeof (r as MessageReference).label === 'string' &&
        typeof (r as MessageReference).route === 'string' &&
        allowedRoutes.has((r as MessageReference).route)
      ) {
        refs.push({ label: (r as MessageReference).label, route: (r as MessageReference).route })
      }
      if (refs.length === 3) break
    }
    if (refs.length > 0) message.references = refs
  }

  const action = groundAction(parsed.action, contactIds, listIds)
  if (action) message.action = action

  return message
}

function groundAction(
  raw: unknown,
  contactIds: Set<string>,
  listIds: Set<string>,
): CompanionAction | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const a = raw as Record<string, unknown>
  const target = typeof a.target === 'string' ? a.target : undefined

  switch (a.kind) {
    case 'draft-email': {
      if (!target || typeof a.subject !== 'string' || typeof a.body !== 'string') return undefined
      const contactId = typeof a.contactId === 'string' && contactIds.has(a.contactId) ? a.contactId : undefined
      return { kind: 'draft-email', target, subject: a.subject, body: a.body, ...(contactId ? { contactId } : {}) }
    }
    case 'add-to-list': {
      if (!target || typeof a.listName !== 'string') return undefined
      const contactId = typeof a.contactId === 'string' && contactIds.has(a.contactId) ? a.contactId : undefined
      const listId = typeof a.listId === 'string' && listIds.has(a.listId) ? a.listId : undefined
      return { kind: 'add-to-list', target, listName: a.listName, ...(contactId ? { contactId } : {}), ...(listId ? { listId } : {}) }
    }
    case 'create-inspection': {
      if (!target || typeof a.when !== 'string' || typeof a.token !== 'string') return undefined
      const token = a.token.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
      if (!token) return undefined
      return { kind: 'create-inspection', target, when: a.when, token }
    }
    case 'dismiss': {
      if (!target) return undefined
      return { kind: 'dismiss', target, ...(typeof a.reason === 'string' ? { reason: a.reason } : {}) }
    }
    default:
      return undefined
  }
}

// ── Fallback (no key / error) ───────────────────────────────────────────────

const FALLBACK_WITH_CONTACT: ReadonlyArray<(name: string) => string> = [
  (name) => `${name} is the warmest name I can see right now — open their timeline and I'll walk you through what they've been doing.`,
  (name) => `I'd start with ${name} — they're carrying the most signal of anyone on file. Their timeline has the detail.`,
  (name) => `${name} stands out at the moment. Take a look at their activity — the pattern's worth a read before you reach out.`,
]

const FALLBACK_EMPTY: ReadonlyArray<string> = [
  `I'm not seeing anyone matching that yet. Name a contact, or ask me who's been most active and I'll point you at them.`,
  `Nothing on file for that one yet. Try a name, or ask about your most active contacts — I'll surface what I can see.`,
]

function pickVariant<T>(variants: ReadonlyArray<T>, key: string): T {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) - hash) + key.charCodeAt(i)
  return variants[Math.abs(hash) % variants.length]
}

/** Deterministic, grounded-but-simple reply used when ANTHROPIC_API_KEY is
 *  unset or the model call fails. Never carries an action — it only ever
 *  points at a real contact it can see. */
export function fallbackReply(prompt: string, g: Grounding): HoraceMessage {
  console.log('[ai:fallback] companion', { contacts: g.contacts.length })
  const focus = g.contacts[0]
  if (focus) {
    return {
      kind: 'horace',
      text: pickVariant(FALLBACK_WITH_CONTACT, prompt + focus.id)(focus.name),
      references: [{ label: `Open ${focus.name}`, route: `/contacts/${focus.id}` }],
    }
  }
  return { kind: 'horace', text: pickVariant(FALLBACK_EMPTY, prompt) }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Generate a grounded companion reply. Pass `client = null` (no API key) to
 * force the deterministic fallback. Retrieval runs either way so the fallback
 * can still point at a real contact.
 */
export async function generateCompanionReply(
  client: Anthropic | null,
  supabase: AdminClient,
  agentId: string,
  workspaceId: string,
  prompt: string,
  contextLabel: string | undefined,
  history: ConversationTurn[] = [],
): Promise<HoraceMessage> {
  const grounding = await retrieveGrounding(supabase, agentId, workspaceId, prompt, contextLabel)
  if (!client) return fallbackReply(prompt, grounding)

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildGroundingBlock(grounding, prompt, history) }],
    })
    const raw = message.content[0]?.type === 'text' ? message.content[0].text : ''
    return groundReply(parseReply(raw), grounding)
  } catch (err) {
    console.error('[ai:companion] generation failed:', err)
    return fallbackReply(prompt, grounding)
  }
}
