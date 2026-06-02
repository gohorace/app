import { describe, it, expect, vi } from 'vitest'
import { actingAs, logAudit, AuditAction } from './log'
import type { SupabaseClient } from '@supabase/supabase-js'

describe('actingAs — two-identity derivation', () => {
  it('an agent acting on their own scope records no acting-as', () => {
    expect(actingAs('agent-A', 'agent-A')).toEqual({
      actingAsAgentId: null,
      scope: 'own',
    })
  })

  it('a support seat acting on a linked agent records the on-behalf identity', () => {
    // actor = support seat's own agent id; owner = the linked agent.
    expect(actingAs('support-S', 'agent-X')).toEqual({
      actingAsAgentId: 'agent-X',
      scope: 'on_behalf',
    })
  })

  it('treats a missing owner as own scope (no acting-as)', () => {
    expect(actingAs('agent-A', null)).toEqual({ actingAsAgentId: null, scope: 'own' })
    expect(actingAs('agent-A', undefined)).toEqual({ actingAsAgentId: null, scope: 'own' })
  })
})

describe('logAudit — best-effort insert', () => {
  function clientReturning(error: unknown): SupabaseClient {
    const insert = vi.fn().mockResolvedValue({ error })
    const from = vi.fn().mockReturnValue({ insert })
    return { from } as unknown as SupabaseClient
  }

  const entry = {
    workspaceId: 'ws-1',
    actorUserId: 'user-1',
    actorAgentId: 'support-S',
    actingAsAgentId: 'agent-X',
    action: AuditAction.ContactUpdate,
    resourceType: 'contact',
    resourceId: 'c-1',
    scope: 'on_behalf',
  }

  it('returns true and inserts the full two-identity row on success', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const client = { from: vi.fn().mockReturnValue({ insert }) } as unknown as SupabaseClient

    const ok = await logAudit(client, entry)

    expect(ok).toBe(true)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: 'ws-1',
        actor_agent_id: 'support-S',
        acting_as_agent_id: 'agent-X',
        action: 'contact.update',
        resource_type: 'contact',
        resource_id: 'c-1',
        scope: 'on_behalf',
      }),
    )
  })

  it('swallows a DB error and returns false (never fails the user action)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ok = await logAudit(clientReturning({ message: 'boom' }), entry)
    expect(ok).toBe(false)
    spy.mockRestore()
  })

  it('defaults acting_as to null and metadata to {} when omitted', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const client = { from: vi.fn().mockReturnValue({ insert }) } as unknown as SupabaseClient

    await logAudit(client, {
      workspaceId: 'ws-1',
      actorUserId: 'user-1',
      actorAgentId: 'agent-A',
      action: AuditAction.EmailSend,
      resourceType: 'email',
    })

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ acting_as_agent_id: null, metadata: {}, resource_id: null }),
    )
  })
})
