/**
 * HOR-217 — Horace-voiced summary line for the Properties Map View.
 *
 * Mirrors the pattern from `lib/ai/briefing.ts::generateBriefingNarrative`:
 *   - Claude Haiku for the live voice
 *   - Deterministic fallback pool when the API is unavailable, picked by
 *     hash of the inputs so the same payload shape gets the same fallback
 *     (no jarring reshuffles on reload)
 *   - Read-through cache against `map_summary_cache` (migration
 *     20260518000041) with a 1-hour TTL keyed on a payload fingerprint
 *
 * The cache key is `(workspace_id, agent_id, time_window, payload_hash)`.
 * `payload_hash` is a stable fingerprint of the inputs — same inputs
 * always map to the same key. Identical scrubber clicks within an hour
 * cost zero LLM calls.
 *
 * MCP-readiness: this function is callable from any server context with
 * an Anthropic client. The cache table is its only side effect.
 */

import { createHash } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MapCounters, TimeWindow } from '@/lib/map/rpc-types'

export interface SummaryInputs {
  counters:        MapCounters
  /** Top warm/hot suburb names in intensity order (max 3 surfaced to the prompt). */
  topSuburbs:      Array<{ name: string; state: 'warm' | 'hot' }>
  /** Stirring suburb names (max 3 surfaced to the prompt). */
  stirringSuburbs: string[]
  timeWindow:      TimeWindow
}

// ─── Fingerprint ────────────────────────────────────────────────────────────

/**
 * Stable hash of the prompt inputs. SHA-256 truncated to 16 hex chars (64 bits
 * of entropy — collision probability ~10⁻¹⁹ across a single workspace's cache,
 * good enough for a 1-hour TTL).
 */
export function summaryFingerprint(inputs: SummaryInputs): string {
  const canonical = JSON.stringify({
    c: inputs.counters,
    t: inputs.topSuburbs.map((s) => `${s.name}:${s.state}`).sort(),
    s: [...inputs.stirringSuburbs].sort(),
    w: inputs.timeWindow,
  })
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

// ─── Public entrypoint ──────────────────────────────────────────────────────

/**
 * Returns a Horace-voiced summary line for the map view. Reads through the
 * Postgres cache; calls Haiku on miss; falls back to a deterministic pool
 * when the LLM is unavailable.
 *
 * @param client     Anthropic client, or `null` to force the fallback pool
 *                   (e.g. when ANTHROPIC_API_KEY is unset in local dev).
 * @param workspaceId Workspace + agent scope the cache row is keyed on.
 * @param agentId
 * @param inputs     Counters, top suburbs, stirring suburbs, time window.
 */
export async function generateMapSummary(
  client: Anthropic | null,
  workspaceId: string,
  agentId: string,
  inputs: SummaryInputs,
): Promise<string> {
  const fingerprint = summaryFingerprint(inputs)
  const admin = createAdminClient()

  // ── 1. Cache lookup ─────────────────────────────────────────────────────
  const { data: cached } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('map_summary_cache' as any)
    .select('summary')
    .eq('workspace_id', workspaceId)
    .eq('agent_id',     agentId)
    .eq('time_window',  inputs.timeWindow)
    .eq('payload_hash', fingerprint)
    .gte('expires_at',  new Date().toISOString())
    .maybeSingle()

  const cachedRow = cached as { summary: string } | null
  if (cachedRow?.summary) return cachedRow.summary

  // ── 2. Generate (Haiku or fallback) ─────────────────────────────────────
  const summary = client && hasSignal(inputs.counters)
    ? await callHaiku(client, inputs)
    : fallbackSummary(inputs)

  // ── 3. Cache write (1-hour TTL — column default handles it) ─────────────
  // upsert because the same agent could refresh twice in the same tick
  // before the cache row lands.
  await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('map_summary_cache' as any)
    .upsert({
      workspace_id: workspaceId,
      agent_id:     agentId,
      time_window:  inputs.timeWindow,
      payload_hash: fingerprint,
      summary,
      expires_at:   new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })

  return summary
}

// ─── Haiku call ─────────────────────────────────────────────────────────────

async function callHaiku(client: Anthropic, inputs: SummaryInputs): Promise<string> {
  const windowLabel = WINDOW_LABEL[inputs.timeWindow]

  const topLine = inputs.topSuburbs.length > 0
    ? inputs.topSuburbs.slice(0, 3).map((s) => `${s.name} (${s.state})`).join(', ')
    : 'no concentrated activity'

  const stirringLine = inputs.stirringSuburbs.length > 0
    ? inputs.stirringSuburbs.slice(0, 3).join(', ')
    : 'none'

  const prompt = `You are Horace — a quiet, intelligent real estate market intelligence system.
Write ONE short sentence (≤ 25 words) describing where signal is concentrating across the agent's market ${windowLabel}.

Context:
- ${inputs.counters.warm} warm suburb${inputs.counters.warm === 1 ? '' : 's'}, ${inputs.counters.active} active listing${inputs.counters.active === 1 ? '' : 's'}, ${inputs.counters.stirring} stirring suburb${inputs.counters.stirring === 1 ? '' : 's'}.
- Top warm/hot suburbs: ${topLine}.
- Stirring suburbs: ${stirringLine}.
- Time window: ${windowLabel}.

Rules:
- No greeting, no preamble. Just the intelligence sentence.
- Confident, brief, slightly poetic. Like a trusted advisor.
- Name 1–2 specific suburbs by name when there's signal worth naming.
- If multiple suburbs are stirring, lead with that.
- Under 25 words.

Examples of voice:
- "Signal concentrating around New Farm and Paddington. Norman Park stirring."
- "Three known vendors on New Farm sold listings. Teneriffe building."
- "Quiet morning. Two hot spots — New Farm waking up."

Respond with the sentence text only — no JSON, no quotes, no markdown.`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 96,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    return text || fallbackSummary(inputs)
  } catch (err) {
    console.error('[ai:map-summary] Haiku call failed:', err)
    return fallbackSummary(inputs)
  }
}

const WINDOW_LABEL: Record<TimeWindow, string> = {
  '24h': 'today',
  '7d':  'this week',
  '30d': 'this month',
}

// ─── Fallbacks ──────────────────────────────────────────────────────────────
//
// Three variants per shape so the empty-AI case (rate-limit, no API key,
// timeout) doesn't feel canned across a session of scrubber clicks. Picked
// deterministically from a stable key so identical inputs → identical fallback.

const FALLBACK_WITH_TOP: ReadonlyArray<(top: string, window: string) => string> = [
  (top, w) => `Signal concentrating around ${top} ${w}. Horace is watching.`,
  (top, w) => `${top} carrying most of the weight ${w}. The shape is forming.`,
  (top, w) => `Most movement around ${top} ${w}. Worth a closer look.`,
]

const FALLBACK_WITH_STIRRING: ReadonlyArray<(stirring: string, window: string) => string> = [
  (stir, w) => `${stir} stirring ${w} — something's shifting underneath.`,
  (stir, w) => `Quiet activity but ${stir} is moving ${w}. Pattern building.`,
  (stir, w) => `Watch ${stir} ${w} — the kind of warmth that precedes a conversation.`,
]

const FALLBACK_QUIET: ReadonlyArray<(window: string) => string> = [
  (w) => `Quiet ${w}. Horace is watching for the first stir.`,
  (w) => `Nothing concentrated ${w}, but the patch is breathing.`,
  (w) => `A still ${w}. Horace stays close.`,
]

function pickVariant<T>(variants: ReadonlyArray<T>, key: string): T {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) - hash) + key.charCodeAt(i)
  return variants[Math.abs(hash) % variants.length]
}

function fallbackSummary(inputs: SummaryInputs): string {
  const window = WINDOW_LABEL[inputs.timeWindow]
  const key = `${inputs.counters.warm}:${inputs.counters.active}:${inputs.counters.stirring}:${inputs.timeWindow}`

  console.log('[ai:fallback] map-summary', { key })

  // Priority: name the top warm/hot suburb if we have one; otherwise lead
  // with stirring; otherwise the quiet line.
  if (inputs.topSuburbs.length > 0) {
    const top = inputs.topSuburbs[0].name
    return pickVariant(FALLBACK_WITH_TOP, key)(top, window)
  }
  if (inputs.stirringSuburbs.length > 0) {
    return pickVariant(FALLBACK_WITH_STIRRING, key)(inputs.stirringSuburbs[0], window)
  }
  return pickVariant(FALLBACK_QUIET, key)(window)
}

function hasSignal(c: MapCounters): boolean {
  return c.warm + c.active + c.stirring > 0
}
