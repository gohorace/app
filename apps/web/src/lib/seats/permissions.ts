/**
 * HOR-203 — Support-seat write permissions.
 *
 * Resolves the set of agent IDs the current user is allowed to write
 * against. For an agent seat this is `[their own agent.id]`. For a
 * support seat this is `[...assigned_agent_ids]` from
 * `support_seat_assignments`.
 *
 * Read visibility is handled at the RLS layer by the v2 `user_agent_ids()`
 * helper (see migration 20260518000003). This module exists for the
 * write paths where the API does a service-role `.eq('agent_id', x)`
 * filter and needs to know which agent IDs are valid for the caller.
 *
 * Defensive: returns an empty array on any error so a misconfigured
 * caller fails closed.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolvePrimaryAgent } from './resolve-agent'

export interface SeatPermissions {
  /** The caller's own agent row id (always 1, even for support seats). */
  callerAgentId: string | null
  /** Whether the caller is on a support seat. */
  isSupport: boolean
  /**
   * Agent IDs the caller can write contact-action mutations against.
   * For agent seats: [callerAgentId]. For support seats: assigned agent IDs.
   */
  allowedAgentIds: string[]
}

export async function getSeatPermissions(
  admin: SupabaseClient,
  userId: string,
): Promise<SeatPermissions> {
  const agent = await resolvePrimaryAgent(admin, userId, { excludeDeparted: true })

  const callerAgentId: string | null = agent?.id ?? null
  const seatType: 'agent' | 'support' = agent?.seat_type ?? 'agent'

  if (!callerAgentId) {
    return { callerAgentId: null, isSupport: false, allowedAgentIds: [] }
  }

  if (seatType !== 'support') {
    return {
      callerAgentId,
      isSupport: false,
      allowedAgentIds: [callerAgentId],
    }
  }

  // Support seat — resolve assigned agent IDs.
  const { data: assignments } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('support_seat_assignments' as any)
    .select('assigned_agent_id')
    .eq('support_agent_id', callerAgentId)

  const allowedAgentIds = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (assignments as any[] | null) ?? []
  )
    .map((row) => row.assigned_agent_id as string)
    .filter(Boolean)

  return {
    callerAgentId,
    isSupport: true,
    allowedAgentIds,
  }
}
