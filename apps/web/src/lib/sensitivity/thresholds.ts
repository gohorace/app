import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

export type Sensitivity = 'low' | 'medium' | 'high'

export const SENSITIVITY_VALUES: readonly Sensitivity[] = ['low', 'medium', 'high'] as const

export const DEFAULT_SENSITIVITY: Sensitivity = 'medium'

/**
 * Effective score threshold per Sensitivity level. Config-driven, not product
 * truth — tunable against real data as live nudges accumulate.
 *
 *   low    — high bar, strong/clear deviations only (fewer, higher precision)
 *   medium — moderate bar, today's default (50 matches the prior numeric knob)
 *   high   — low bar, surface earlier signals (more false starts)
 *
 * Per-contact baselines don't exist yet (engine outcome 2 — partial); when
 * they land, this mapping repoints to confidence-against-baseline without UI
 * changes.
 */
export const SCORE_THRESHOLDS: Record<Sensitivity, number> = {
  low: 75,
  medium: 50,
  high: 25,
}

export function effectiveScoreThreshold(sensitivity: Sensitivity): number {
  return SCORE_THRESHOLDS[sensitivity]
}

function normalize(raw: unknown): Sensitivity {
  return raw === 'low' || raw === 'high' ? raw : DEFAULT_SENSITIVITY
}

type AdminClient = SupabaseClient<Database>

/**
 * Resolves the workspace's Sensitivity from an agent_id. Falls back to
 * `medium` if the agent has no workspace (orphan rows during onboarding) or
 * if the column is somehow missing.
 */
export async function getWorkspaceSensitivity(
  supabase: AdminClient,
  agentId: string,
): Promise<Sensitivity> {
  const { data: agent } = await supabase
    .from('agents')
    .select('workspace_id')
    .eq('id', agentId)
    .maybeSingle()

  if (!agent?.workspace_id) return DEFAULT_SENSITIVITY

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('sensitivity')
    .eq('id', agent.workspace_id)
    .maybeSingle()

  return normalize(workspace?.sensitivity)
}

/**
 * Convenience: lookup + threshold in one call. Used by alert dispatch paths.
 */
export async function getEffectiveScoreThresholdForAgent(
  supabase: AdminClient,
  agentId: string,
): Promise<number> {
  const sensitivity = await getWorkspaceSensitivity(supabase, agentId)
  return effectiveScoreThreshold(sensitivity)
}
