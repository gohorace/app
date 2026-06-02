/**
 * HOR-374 — Unified audit log writer (Phase 2 of the Access Control epic).
 *
 * One front door for appending to `audit_log`. Captures TWO identities where one
 * acts on behalf of another (Support → linked agent): `actorAgentId` (who acted)
 * and `actingAsAgentId` (whose scope it was). They never collapse — pass
 * actingAsAgentId only when the action targets a scope other than the actor's own.
 *
 * Best-effort: a failed audit insert logs and swallows rather than failing the
 * user's action. The table is service-role-only (RLS denies authenticated writes),
 * so always pass the admin/service client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Canonical action verbs. Extend as consumers are wired in later phases. */
export const AuditAction = {
  ContactUpdate: 'contact.update',
  ContactDelete: 'contact.delete',
  EmailSend: 'email.send',
  EmailSchedule: 'email.schedule',
  PropertyReassign: 'property.reassign',
  RoleChange: 'member.role_change',
  MemberRemove: 'member.remove',
  MemberInvite: 'member.invite',
  ExportAccount: 'export.account',
  ExportScope: 'export.scope',
  ExportGrant: 'export.grant',
  ExportRevoke: 'export.revoke',
} as const

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction]

export interface AuditEntry {
  workspaceId: string
  actorUserId: string | null
  actorAgentId: string | null
  /**
   * The agent whose scope the action was performed in, when acting on behalf
   * (Support → linked agent). Omit/null when the actor acted in their own scope.
   */
  actingAsAgentId?: string | null
  action: AuditActionValue | string
  resourceType: string
  resourceId?: string | null
  /** Free-form scope marker: 'own' | 'on_behalf' | 'account' | … */
  scope?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Append one row to `audit_log`. Never throws — returns true on success, false on
 * a swallowed error (logged to the server console).
 */
export async function logAudit(
  admin: SupabaseClient,
  entry: AuditEntry,
): Promise<boolean> {
  try {
    const { error } = await admin
      // audit_log isn't in the generated types yet (regen deferred).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('audit_log' as any)
      .insert({
        workspace_id: entry.workspaceId,
        actor_user_id: entry.actorUserId,
        actor_agent_id: entry.actorAgentId,
        acting_as_agent_id: entry.actingAsAgentId ?? null,
        action: entry.action,
        resource_type: entry.resourceType,
        resource_id: entry.resourceId ?? null,
        scope: entry.scope ?? null,
        metadata: entry.metadata ?? {},
      })

    if (error) {
      console.error('[audit] insert failed', { action: entry.action, error })
      return false
    }
    return true
  } catch (err) {
    console.error('[audit] insert threw', { action: entry.action, err })
    return false
  }
}

/**
 * Derive the `actingAsAgentId` + `scope` for an action against a resource owned
 * by `ownerAgentId`, given the actor's own agent id. When the owner differs from
 * the actor (a Support seat acting on a linked agent's resource) we record the
 * on-behalf identity; otherwise the actor acted in their own scope.
 */
export function actingAs(
  actorAgentId: string | null,
  ownerAgentId: string | null | undefined,
): { actingAsAgentId: string | null; scope: 'own' | 'on_behalf' } {
  if (ownerAgentId && ownerAgentId !== actorAgentId) {
    return { actingAsAgentId: ownerAgentId, scope: 'on_behalf' }
  }
  return { actingAsAgentId: null, scope: 'own' }
}
