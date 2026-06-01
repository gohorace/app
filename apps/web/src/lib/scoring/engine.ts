import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { DEFAULT_SCORING_RULES } from './rules'
import type { EventType, IncomingEvent, ScoreResult, ScoringRule, ScoringRuleOverride } from './types'
import {
  sendScoreThresholdAlert,
  sendFormSubmitAlert,
  sendReturnVisitAlert,
  sendInspectionRevisitAlert,
} from '../notifications/push'

type AdminClient = SupabaseClient<Database>

/**
 * Merges agent-specific rule overrides with the defaults.
 */
function resolveRules(agentOverrides: ScoringRuleOverride): ScoringRule[] {
  return DEFAULT_SCORING_RULES.map((rule) => {
    const override = agentOverrides[rule.event_type]
    return override ? { ...rule, ...override } : rule
  })
}

/**
 * Scores a batch of events for a known contact.
 * Applies per-session caps and writes score + history in a single transaction.
 */
export async function scoreEventsForContact(
  supabase: AdminClient,
  agentId: string,
  contactId: string,
  events: IncomingEvent[],
  agentOverrides: ScoringRuleOverride = {},
): Promise<ScoreResult> {
  const rules = resolveRules(agentOverrides)

  // Group events by session to enforce per-session caps
  const sessionCounts: Record<string, Record<string, number>> = {}
  for (const evt of events) {
    if (!sessionCounts[evt.session_id]) sessionCounts[evt.session_id] = {}
    const counts = sessionCounts[evt.session_id]
    counts[evt.event_type] = (counts[evt.event_type] ?? 0) + 1
  }

  // Calculate total delta applying caps and conditions
  let delta = 0
  const appliedRules: ScoreResult['appliedRules'] = []

  for (const rule of rules) {
    // Sum events of this type across all sessions (capped per session)
    let totalCapped = 0
    for (const sessionId of Object.keys(sessionCounts)) {
      let count = sessionCounts[sessionId][rule.event_type] ?? 0
      if (count === 0) continue

      // Check conditions (e.g. scroll depth threshold). Only events that
      // actually satisfy the condition may score — otherwise a single deep
      // scroll would let every shallow scroll in the session earn points too.
      if (rule.conditions?.pct_gte !== undefined) {
        const matchingEvents = events.filter(
          (e) =>
            e.session_id === sessionId &&
            e.event_type === rule.event_type &&
            e.properties !== null &&
            typeof e.properties === 'object' &&
            !Array.isArray(e.properties) &&
            typeof (e.properties as Record<string, unknown>).pct === 'number' &&
            ((e.properties as Record<string, unknown>).pct as number) >= rule.conditions!.pct_gte!,
        )
        if (matchingEvents.length === 0) continue
        count = matchingEvents.length
      }

      const capped = rule.max_per_session != null ? Math.min(count, rule.max_per_session) : count
      totalCapped += capped
    }

    if (totalCapped > 0) {
      const points = rule.points * totalCapped
      delta += points
      appliedRules.push({ event_type: rule.event_type, points, count: totalCapped })
    }
  }

  if (delta === 0) {
    // Fetch current score to return accurate newScore
    const { data: contact } = await supabase
      .from('contacts')
      .select('score')
      .eq('id', contactId)
      .single()
    return { delta: 0, newScore: contact?.score ?? 0, appliedRules: [] }
  }

  // Fetch current score (needed for history record)
  const { data: contactBefore, error: fetchErr } = await supabase
    .from('contacts')
    .select('score')
    .eq('id', contactId)
    .single()

  if (fetchErr || !contactBefore) {
    throw new Error(`Failed to fetch contact score: ${fetchErr?.message}`)
  }

  const scoreBefore = contactBefore.score
  const scoreAfter = scoreBefore + delta

  // Update contact score
  const { error: updateErr } = await supabase
    .from('contacts')
    .update({ score: scoreAfter })
    .eq('id', contactId)

  if (updateErr) throw new Error(`Failed to update score: ${updateErr.message}`)

  // Write score history entries (one per rule applied)
  let runningScore = scoreBefore
  const historyRows = appliedRules.map(({ event_type, points }) => {
    const before = runningScore
    runningScore += points
    return {
      agent_id: agentId,
      contact_id: contactId,
      delta: points,
      reason: event_type,
      score_before: before,
      score_after: runningScore,
    }
  })

  await supabase.from('score_history').insert(historyRows)

  // Fetch contact name + agent alert mode
  const [{ data: contact }, { data: agentSettingsRow }] = await Promise.all([
    supabase.from('contacts').select('first_name, last_name, email').eq('id', contactId).maybeSingle(),
    supabase.from('agent_settings').select('push_alert_mode, sms_threshold_score').eq('agent_id', agentId).maybeSingle(),
  ])

  const contactName =
    [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') ||
    contact?.email ||
    'A contact'

  const alertMode = (agentSettingsRow?.push_alert_mode ?? 'threshold') as 'threshold' | 'all' | 'hourly_digest'

  // Fire push alerts based on agent's chosen mode (non-blocking)
  if (alertMode !== 'hourly_digest') {
    const hasFormSubmit  = events.some((e) => e.event_type === 'form_submit')
    const hasReturnVisit = events.some((e) => e.event_type === 'return_visit')
    const formEvent      = events.find((e) => e.event_type === 'form_submit') ?? null
    const formName =
      formEvent?.properties &&
      typeof formEvent.properties === 'object' &&
      !Array.isArray(formEvent.properties)
        ? ((formEvent.properties as Record<string, unknown>).form_name as string | null) ?? null
        : null

    // HOR-154: when a contact who signed in to a Doorstep inspection in
    // the last 30 days comes back to the agent's tracked site, swap the
    // generic return-visit / score-threshold copy for the
    // inspection-aware variant. Form submits stay generic — a new form
    // submission isn't a "they're back" event.
    const recentInspection = await detectRecentInspectionContext(supabase, contactId, events)

    // Await — fire-and-forget is killed by Vercel before the push fetch completes
    await Promise.all([
      // Form submit alert is independent of the revisit variant — always
      // uses the generic helper when present.
      hasFormSubmit ? sendFormSubmitAlert(agentId, contactId, contactName, formName) : null,

      // Inspection variant: fires for return-visits OR threshold crosses
      // OR (all-mode general activity) when the contact has a recent
      // inspection scan. The helper itself doesn't self-gate on threshold,
      // so we just suppress the generic threshold/return-visit helpers
      // below when we fire this one — dedup in dispatchPushAlert prevents
      // double-buzz on the same contact.
      recentInspection &&
      (hasReturnVisit || isThresholdCross(scoreBefore, scoreAfter, agentSettingsRow?.sms_threshold_score) ||
        (alertMode === 'all' && !hasFormSubmit && !hasReturnVisit))
        ? sendInspectionRevisitAlert(
            agentId,
            contactId,
            contactName,
            recentInspection.street,
            recentInspection.behaviour,
          )
        : null,

      // Generic threshold + return-visit fall through only when there's
      // no recent inspection scan to swap to.
      recentInspection
        ? null
        : sendScoreThresholdAlert(agentId, contactId, contactName, scoreAfter, scoreBefore),
      recentInspection
        ? null
        : hasReturnVisit
          ? sendReturnVisitAlert(agentId, contactId, contactName)
          : null,
      // 'all' mode: alert on general activity (page/property views etc.)
      // when no specific form/return event fired AND no recent inspection.
      !recentInspection && alertMode === 'all' && !hasFormSubmit && !hasReturnVisit
        ? sendReturnVisitAlert(agentId, contactId, contactName)
        : null,
    ]).catch((err) => console.error('[alerts] push error:', err))
  }
  // hourly_digest: no real-time push — handled by the hourly digest cron

  return { delta, newScore: scoreAfter, appliedRules }
}

/**
 * Returns agent-specific scoring config overrides from agent_settings.
 * Falls back to empty object (defaults used) if not set.
 */
export async function getAgentScoringOverrides(
  supabase: AdminClient,
  agentId: string,
): Promise<ScoringRuleOverride> {
  const { data } = await supabase
    .from('agent_settings')
    .select('scoring_config')
    .eq('agent_id', agentId)
    .single()

  return (data?.scoring_config as ScoringRuleOverride) ?? {}
}

// ─────────────────────────────────────────────────────────────────────────────
// HOR-154 — inspection revisit detection
//
// When a contact's most recent inspection scan is within the last 30 days,
// downstream push alerts use the inspection-aware variant copy. Helpers
// live alongside the scoring engine so the dispatch block stays terse.
// ─────────────────────────────────────────────────────────────────────────────

const RECENT_SCAN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_SCORE_THRESHOLD = 50

interface RecentInspectionContext {
  /** The street_name from the property associated with the most recent scan. */
  street: string
  /** Short verb phrase describing what the contact just did, e.g.
   * "looking at properties". Used as the push body prefix. */
  behaviour: string
}

async function detectRecentInspectionContext(
  supabase: AdminClient,
  contactId: string,
  events: IncomingEvent[],
): Promise<RecentInspectionContext | null> {
  const sinceIso = new Date(Date.now() - RECENT_SCAN_WINDOW_MS).toISOString()

  // Most recent scan in the 30-day window; pull the parent inspection's
  // property street_name through the nested join.
  // database.types.ts hasn't been regenerated for inspections yet — cast
  // through `as never` until the regen commit on the HOR-146 branch lands.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase
    .from('inspection_scans' as never)
    .select('captured_at, inspections(properties(street_name))')
    .eq('contact_id', contactId)
    .gte('captured_at', sinceIso)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle() as any)

  if (error) {
    // Don't let a scan lookup failure block the entire scoring path.
    console.warn('[engine] inspection scan lookup failed:', error)
    return null
  }
  if (!data) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any
  const street: string | null =
    row?.inspections?.properties?.street_name ?? null
  if (!street || street.trim().length === 0) return null

  return {
    street: street.trim(),
    behaviour: computeBehaviour(events),
  }
}

/**
 * Maps the most-relevant triggering event in this batch to a short verb
 * phrase suitable for the push body. Priority:
 *
 *   property_view              → "looking at properties"
 *   page/scroll on /appraisal  → "back on your appraisal page"
 *   anything else              → "back on your site"
 */
function computeBehaviour(events: IncomingEvent[]): string {
  if (events.some((e) => e.event_type === 'property_view')) {
    return 'looking at properties'
  }

  const onAppraisalPage = events.some((e) => {
    if (e.event_type !== 'page_view' && e.event_type !== 'scroll_depth') return false
    if (!e.properties || typeof e.properties !== 'object' || Array.isArray(e.properties)) {
      return false
    }
    const props = e.properties as Record<string, unknown>
    const url = typeof props.url === 'string' ? props.url : null
    return !!url && url.toLowerCase().includes('appraisal')
  })
  if (onAppraisalPage) return 'back on your appraisal page'

  return 'back on your site'
}

function isThresholdCross(
  scoreBefore: number,
  scoreAfter: number,
  configuredThreshold: number | null | undefined,
): boolean {
  const threshold = configuredThreshold ?? DEFAULT_SCORE_THRESHOLD
  return scoreBefore < threshold && scoreAfter >= threshold
}
