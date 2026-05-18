import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  RecoverTextResponse,
  SuburbCandidate,
} from './types'

/**
 * POST /api/onboarding/recover-text  — LLM-backed free-text rescue.
 *
 * Two modes:
 *   • turn:'patch'  → extract candidate AU suburb names from free
 *                     text (e.g. "northern beaches"). LLM emits names
 *                     only; the route re-validates each via the
 *                     search_localities RPC so callers only ever see
 *                     real locality_pids. Never returns invented IDs.
 *   • turn:'rescue' → Horace writes a one-sentence offer of retry-or-
 *                     bail. Used by turns that hit twice-unparseable
 *                     input.
 *
 * Guardrails:
 *   • Anthropic Haiku, max_tokens 256, JSON-only output. Strict parse,
 *     try/catch falls back to deterministic JSON.
 *   • Auth-gated.
 *   • In-memory rate limit per user (8 calls / 60s).
 *   • If ANTHROPIC_API_KEY is unset (preview env without secrets, CI),
 *     skip the LLM call entirely and return the fallback shape — no
 *     5xx.
 *
 * Types live in ./types — Next.js 14 disallows non-route exports
 * from route.ts.
 */

export const runtime = 'nodejs'

const MAX_INPUT_LEN = 200
const MAX_CANDIDATES = 3
const MAX_LLM_TOKENS = 256

// Simple in-memory token bucket. Per-user, ephemeral; resets on cold
// start. Fine for an onboarding-only surface where each user hits this
// at most a handful of times.
const BUCKETS = new Map<string, { tokens: number; updatedAt: number }>()
const BUCKET_CAPACITY = 8
const BUCKET_REFILL_PER_SEC = 8 / 60 // 8 per minute

function takeToken(userId: string): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now()
  const b = BUCKETS.get(userId) ?? { tokens: BUCKET_CAPACITY, updatedAt: now }
  const elapsedSec = (now - b.updatedAt) / 1000
  const refilled = Math.min(BUCKET_CAPACITY, b.tokens + elapsedSec * BUCKET_REFILL_PER_SEC)
  if (refilled < 1) {
    const needed = 1 - refilled
    const retryAfter = Math.ceil(needed / BUCKET_REFILL_PER_SEC)
    BUCKETS.set(userId, { tokens: refilled, updatedAt: now })
    return { ok: false, retryAfter }
  }
  BUCKETS.set(userId, { tokens: refilled - 1, updatedAt: now })
  return { ok: true }
}

const schema = z.object({
  turn: z.enum(['patch', 'rescue']),
  input: z.string().min(1).max(MAX_INPUT_LEN),
  context: z
    .object({
      selectedSuburbs: z.array(z.string()).optional(),
      turnLabel: z.string().optional(),
    })
    .optional(),
})

const RESCUE_FALLBACK: RecoverTextResponse = {
  kind: 'rescue',
  horace_line:
    "I'm not getting that. Want to type it again, or use the classic setup?",
  suggested_next_action: 'bail',
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = takeToken(user.id)
  if (!limit.ok) {
    return NextResponse.json(
      {
        kind: 'rate_limited',
        retry_after_seconds: limit.retryAfter,
      } satisfies RecoverTextResponse,
      { status: 200 },
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { kind: 'error', message: 'Invalid request' } satisfies RecoverTextResponse,
      { status: 200 },
    )
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // Preview env without secrets / CI — return the deterministic
    // fallback so the caller never sees a 5xx.
    if (parsed.data.turn === 'patch') {
      return NextResponse.json(
        { kind: 'suburb_candidates', items: [] } satisfies RecoverTextResponse,
        { status: 200 },
      )
    }
    return NextResponse.json(RESCUE_FALLBACK, { status: 200 })
  }

  const client = new Anthropic({ apiKey })

  if (parsed.data.turn === 'patch') {
    const result = await recoverPatch(client, parsed.data.input, parsed.data.context)
    return NextResponse.json(result, { status: 200 })
  }

  const result = await recoverRescue(client, parsed.data.input, parsed.data.context)
  return NextResponse.json(result, { status: 200 })
}

// ─── patch recovery ────────────────────────────────────────────────

async function recoverPatch(
  client: Anthropic,
  input: string,
  context?: { selectedSuburbs?: string[] },
): Promise<RecoverTextResponse> {
  const alreadyChosen = context?.selectedSuburbs?.length
    ? `Already chosen: ${context.selectedSuburbs.join(', ')}.`
    : ''

  const prompt = `You map free-text Australian real-estate-agent suburb mentions to a candidate list.

The agent typed: "${input}".
${alreadyChosen}

Return up to ${MAX_CANDIDATES} distinct AU suburb names (proper case) the agent likely meant. Use the canonical G-NAF locality name (single suburb, not a region). Examples:
  "northern beaches" → ["Manly", "Avalon", "Mona Vale"]
  "inner west sydney" → ["Newtown", "Marrickville", "Leichhardt"]
  "by the gabba" → ["Woolloongabba", "East Brisbane"]
  "dandenongs vic" → ["Belgrave", "Olinda", "Sassafras"]

Respond with JSON only:
{"candidates": ["Suburb One", "Suburb Two"]}

If genuinely unsure, return {"candidates": []}. No prose.`

  let names: string[] = []
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: MAX_LLM_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = message.content[0].type === 'text' ? message.content[0].text : ''
    const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const json = JSON.parse(text) as { candidates?: unknown }
    if (Array.isArray(json.candidates)) {
      names = json.candidates
        .filter((c): c is string => typeof c === 'string')
        .map((c) => c.trim())
        .filter(Boolean)
        .slice(0, MAX_CANDIDATES)
    }
  } catch (err) {
    console.error('[recover-text/patch] LLM error', err)
    return { kind: 'suburb_candidates', items: [] }
  }

  if (names.length === 0) {
    return { kind: 'suburb_candidates', items: [] }
  }

  // Re-validate every candidate via search_localities. The LLM only
  // gets to suggest names; the RPC gates which become real
  // locality_pids. This is the load-bearing safety net — without it
  // a hallucinated suburb would crash core_markets insertion later.
  const admin = createAdminClient()
  const items: SuburbCandidate[] = []
  const seen = new Set<string>()

  for (const name of names) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await admin.rpc('search_localities' as any, {
      p_q: name,
      p_limit: 3,
    })
    if (error) {
      console.error('[recover-text/patch] search_localities error', error)
      continue
    }
    const rows = (data as SuburbCandidate[] | null) ?? []
    // Take the first prefix-match-ranked result that we haven't
    // already added. The RPC already orders prefix-match first.
    for (const row of rows) {
      if (!seen.has(row.locality_pid)) {
        items.push(row)
        seen.add(row.locality_pid)
        break // one match per LLM candidate, then move on
      }
    }
    if (items.length >= MAX_CANDIDATES) break
  }

  return { kind: 'suburb_candidates', items }
}

// ─── rescue line ───────────────────────────────────────────────────

async function recoverRescue(
  client: Anthropic,
  input: string,
  context?: { turnLabel?: string },
): Promise<RecoverTextResponse> {
  const where = context?.turnLabel ? ` (during "${context.turnLabel}")` : ''
  const prompt = `You are Horace — a quiet AU real-estate intelligence assistant.

The agent typed something I couldn't parse${where}. Write ONE sentence offering them either a retry framing or the classic setup as an out. Voice rules: first person ("I'll…"), no emojis, no exclamation marks, AU vocabulary ("suburb" not "neighborhood", "patch" not "territory", "appraisal" not "valuation"). Conversational, colleague-over-the-desk tone. Do not invoke "Seize the moment" (that's the sign-off, used only at the end of onboarding).

Their last input: "${input}".

Respond JSON only:
{"line": "…", "action": "retry" | "bail"}`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: MAX_LLM_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = message.content[0].type === 'text' ? message.content[0].text : ''
    const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const json = JSON.parse(text) as { line?: unknown; action?: unknown }
    const line = typeof json.line === 'string' ? json.line.trim() : ''
    const action = json.action === 'retry' ? 'retry' : 'bail'
    if (!line || /[!]/.test(line)) {
      // Voice safety net — never surface an exclamation-mark Horace.
      return RESCUE_FALLBACK
    }
    return {
      kind: 'rescue',
      horace_line: line,
      suggested_next_action: action,
    }
  } catch (err) {
    console.error('[recover-text/rescue] LLM error', err)
    return RESCUE_FALLBACK
  }
}
