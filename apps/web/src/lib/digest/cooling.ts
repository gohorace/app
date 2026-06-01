/**
 * Stream V2 (HOR-365) — "Cooling down" detection.
 *
 * A Cooling-down contact is a *momentum reversal*: someone who was active and
 * has since gone to ~nil activity. The drop-off itself is the signal — worth a
 * gentle re-engagement before they're lost. This is distinct from Quiet (never
 * warm) and from the active roster (still warm).
 *
 * Cooling contacts have, by definition, gone quiet — so they're NOT in the
 * digest's active-leads roster (`get_daily_briefing_data`). We surface them
 * separately from `score_history`, the per-contact audit trail of scored
 * activity (page/property views etc.), which is indexed by
 * (agent_id, occurred_at) and (contact_id, occurred_at).
 *
 * The derivation is deliberately conservative (two clear windows, a minimum
 * prior-activity bar) so it doesn't over-fire — tune the thresholds later.
 */

/** A scored-activity row, reduced to what the windowing needs. */
export interface CoolingActivityRow {
  contactId: string
  occurredAt: string
}

export interface CoolingCandidate {
  /** Count of scored activities in the prior (active) window. */
  priorCount: number
  /** Whole days since the contact's last scored activity. */
  gapDays: number
}

export interface CoolingOptions {
  /** Recent window (days). Activity in here disqualifies — they're not cool. */
  recentDays: number
  /** Prior window outer bound (days). Activity between recent..prior = "was active". */
  priorDays: number
  /** Minimum prior-window activities to count as having been meaningfully active. */
  priorMin: number
}

export const DEFAULT_COOLING: CoolingOptions = {
  recentDays: 7,
  priorDays: 28,
  priorMin: 3,
}

/**
 * Bucket scored-activity rows into cooling candidates.
 *
 * A contact cools down when it had ≥ `priorMin` scored activities in the prior
 * window (recentDays..priorDays ago) but **zero** in the recent window
 * (last recentDays). `gapDays` reads from the most-recent prior activity.
 *
 * Rows older than `priorDays` are ignored. Pass only one agent's rows.
 */
export function findCoolingCandidates(
  rows: CoolingActivityRow[],
  now: Date,
  opts: CoolingOptions = DEFAULT_COOLING,
): Map<string, CoolingCandidate> {
  const nowMs = now.getTime()
  const recentCutoff = nowMs - opts.recentDays * 86_400_000
  const priorCutoff = nowMs - opts.priorDays * 86_400_000

  type Acc = { recent: number; prior: number; lastPriorMs: number }
  const byContact = new Map<string, Acc>()

  for (const row of rows) {
    const t = new Date(row.occurredAt).getTime()
    if (Number.isNaN(t) || t < priorCutoff) continue
    let acc = byContact.get(row.contactId)
    if (!acc) {
      acc = { recent: 0, prior: 0, lastPriorMs: 0 }
      byContact.set(row.contactId, acc)
    }
    if (t >= recentCutoff) {
      acc.recent++
    } else {
      acc.prior++
      if (t > acc.lastPriorMs) acc.lastPriorMs = t
    }
  }

  const out = new Map<string, CoolingCandidate>()
  for (const [contactId, acc] of byContact) {
    if (acc.recent > 0) continue
    if (acc.prior < opts.priorMin) continue
    const gapDays = Math.floor((nowMs - acc.lastPriorMs) / 86_400_000)
    out.set(contactId, { priorCount: acc.prior, gapDays })
  }
  return out
}
