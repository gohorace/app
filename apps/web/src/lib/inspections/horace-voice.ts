import type { InspectionAggregate } from './aggregates'

/**
 * HOR-249 — the Horace voice line above the inspections list.
 *
 * Deterministic for v2.0 (no LLM call on this surface): leads with the
 * most recent past inspection that captured sign-ins. The shape mirrors
 * the prototype's *"Buderim picked up 12 sign-ins on Saturday — 3 are
 * still active."* A Haiku upgrade can drop in later behind the same
 * signature (see `lib/ai/briefing.ts` for the pattern).
 *
 * Returns null when there's nothing worth saying (no past inspection with
 * sign-ins) — the caller renders no strip rather than a hollow one.
 */

export interface InspectionVoiceInput {
  /** Suburb or short address label of the inspection. */
  label: string
  scheduledAt: string
  aggregate: InspectionAggregate
  /** Detail route to deep-link the "See sign-ins →" button. */
  inspectionId: string
}

export interface InspectionVoice {
  line: string
  inspectionId: string
}

export function composeInspectionVoice(
  pastInspections: InspectionVoiceInput[],
): InspectionVoice | null {
  const candidate = pastInspections
    .filter((i) => i.aggregate.signIns > 0)
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0]
  if (!candidate) return null

  const { label, scheduledAt, aggregate } = candidate
  const day = new Intl.DateTimeFormat('en-AU', { weekday: 'long' }).format(new Date(scheduledAt))
  const n = aggregate.signIns
  const active = aggregate.convertedToActive

  const tail =
    active > 0
      ? `${active} ${active === 1 ? 'is' : 'are'} still active.`
      : `none have stirred since.`

  return {
    inspectionId: candidate.inspectionId,
    line: `${label} picked up ${n} ${n === 1 ? 'sign-in' : 'sign-ins'} on ${day} — ${tail}`,
  }
}
