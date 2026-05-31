/**
 * Contact V2 (HOR-246) — pure derivations for the Signal block.
 *
 * The contact-detail page already assembles the merged `events` array and the
 * contact `score`. This module turns that existing data into the three new
 * presentational bits the Signal block needs — a temperature tier, a weekly
 * delta, and a short set of honest "what changed" chips — with **no new DB
 * queries or columns**. Where the events don't carry enough to label a chip
 * truthfully, we omit it rather than invent copy.
 */

import { intentForScore, INTENT_PALETTE } from '@/lib/design/intent'
import type { MergedEvent } from '@/lib/contacts/events'

// ── Temperature tier ─────────────────────────────────────────────────────────
// Mirrors the dial design: high intent → Hot (Terracotta), mid → Warming
// (Mustard), low/none → Cold (Stone). Colours come straight from the shared
// intent palette so the dial, badges, and digest never drift.

export type TempWord = 'Hot' | 'Warming' | 'Cold'

export interface TempTier {
  word: TempWord
  /** Tier colour for the dial arc, flame, delta pill, and chip icons. */
  color: string
  /** Arc fill fraction, 0–1. `score / 100`, clamped. */
  pct: number
}

const STONE = '#8C7B6B'

export function tierForScore(score: number): TempTier {
  const level = intentForScore(score)
  const pct = Math.max(0, Math.min(1, score / 100))
  if (level === 'high') return { word: 'Hot', color: INTENT_PALETTE.high.dot, pct }
  if (level === 'mid') return { word: 'Warming', color: INTENT_PALETTE.mid.dot, pct }
  return { word: 'Cold', color: STONE, pct }
}

// ── Weekly delta ─────────────────────────────────────────────────────────────
// Count of score-positive events in the trailing 7 days. Drives the
// "↑ +N this wk" pill pinned under the dial. Returns null when there's no
// positive movement to report (the pill is then omitted).

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function weeklyDelta(events: MergedEvent[], now: number = Date.now()): number | null {
  const since = now - WEEK_MS
  let delta = 0
  for (const e of events) {
    const t = new Date(e.occurred_at).getTime()
    if (Number.isNaN(t) || t < since) continue
    if (e.score_delta > 0) delta += e.score_delta
  }
  return delta > 0 ? delta : null
}

// ── "What changed" chips ─────────────────────────────────────────────────────
// A few human, behaviour-derived chips for the Signal block. Each chip is only
// emitted when the underlying events actually support it — no fabricated copy.
// Capped at 3, ordered most-to-least telling.

export type ChipIcon = 'repeat' | 'eye' | 'pen' | 'mail' | 'clock'

export interface ChangeChip {
  icon: ChipIcon
  label: string
}

/** Distinct calendar days (local) that carried any event in the trailing week. */
function sessionsThisWeek(events: MergedEvent[], now: number): number {
  const since = now - WEEK_MS
  const days = new Set<string>()
  for (const e of events) {
    const t = new Date(e.occurred_at).getTime()
    if (Number.isNaN(t) || t < since) continue
    days.add(new Date(e.occurred_at).toISOString().slice(0, 10))
  }
  return days.size
}

function pageCategory(e: MergedEvent): 'appraisal' | 'sold' | null {
  if (e.event_type !== 'page_view' && e.event_type !== 'property_view') return null
  const path = String(e.properties.path ?? e.properties.url ?? '').toLowerCase()
  if (path.includes('appraisal')) return 'appraisal'
  if (path.includes('sold')) return 'sold'
  return null
}

// ── Read provenance ──────────────────────────────────────────────────────────
// The "Built from N sessions + …" line under Horace's read — the same merged
// events the chips derive from, summarised as a one-line source attribution.
// Honest: only names what the events actually contain. Null when there's
// nothing in the trailing week to attribute the read to.

export function readProvenance(events: MergedEvent[], now: number = Date.now()): string | null {
  const sessions = sessionsThisWeek(events, now)
  if (sessions === 0) return null

  const since = now - WEEK_MS
  let formStarts = 0
  let soldViews = 0
  let appraisalViews = 0
  for (const e of events) {
    const t = new Date(e.occurred_at).getTime()
    if (Number.isNaN(t) || t < since) continue
    if (e.event_type === 'form_submit' || e.event_type === 'form_start') formStarts += 1
    const cat = pageCategory(e)
    if (cat === 'sold') soldViews += 1
    if (cat === 'appraisal') appraisalViews += 1
  }

  const sessionPart = sessions === 1 ? '1 session' : `${sessions} sessions`
  let extra: string | null = null
  if (formStarts > 0) extra = 'an appraisal form'
  else if (appraisalViews > 0) extra = 'the appraisal page'
  else if (soldViews > 0) extra = soldViews === 1 ? 'a sold result' : 'sold results'

  return extra
    ? `Built from ${sessionPart} + ${extra} this week`
    : `Built from ${sessionPart} this week`
}

export function whatChanged(events: MergedEvent[], now: number = Date.now()): ChangeChip[] {
  const chips: ChangeChip[] = []

  // 1. Repeat sessions this week — the strongest "they're back" signal.
  const sessions = sessionsThisWeek(events, now)
  if (sessions >= 2) {
    chips.push({ icon: 'repeat', label: `Back ${sessions}× this week` })
  }

  // 2. Read sold results — count distinct sold-result views in the window.
  const since = now - WEEK_MS
  let soldViews = 0
  let appraisalViews = 0
  let formStarts = 0
  let emailEngaged = 0
  for (const e of events) {
    const t = new Date(e.occurred_at).getTime()
    if (Number.isNaN(t) || t < since) continue
    const cat = pageCategory(e)
    if (cat === 'sold') soldViews += 1
    if (cat === 'appraisal') appraisalViews += 1
    if (e.event_type === 'form_submit' || e.event_type === 'form_start') formStarts += 1
    if (e.event_type === 'email_opened' || e.event_type === 'email_clicked') emailEngaged += 1
  }
  if (soldViews > 0) {
    chips.push({
      icon: 'eye',
      label: soldViews === 1 ? 'Read a sold result' : `Read ${soldViews} sold results`,
    })
  }

  // 3. Appraisal / form intent — the closest-to-conversion behaviour.
  if (formStarts > 0) {
    chips.push({ icon: 'pen', label: 'Started an appraisal form' })
  } else if (appraisalViews > 0) {
    chips.push({ icon: 'eye', label: 'Viewed the appraisal page' })
  } else if (emailEngaged > 0) {
    chips.push({ icon: 'mail', label: emailEngaged === 1 ? 'Opened your email' : 'Engaging with your emails' })
  }

  return chips.slice(0, 3)
}
