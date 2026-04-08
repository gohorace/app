import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { DEFAULT_SCORING_RULES } from './rules'
import type { EventType, IncomingEvent, ScoreResult, ScoringRule, ScoringRuleOverride } from './types'
import { sendSmsIfThresholdCrossed } from '../notifications/sms'

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
      const count = sessionCounts[sessionId][rule.event_type] ?? 0
      if (count === 0) continue

      // Check conditions (e.g. scroll depth threshold)
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

  // Check SMS threshold (non-blocking — don't fail if SMS fails)
  sendSmsIfThresholdCrossed(supabase, agentId, contactId, scoreBefore, scoreAfter).catch(
    (err) => console.error('SMS check error:', err),
  )

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
