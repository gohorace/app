/**
 * HOR-375 — sovereign-layer export builder (Phase 7, Access Control epic).
 *
 * Assembles the data the account (or a single agent's scope) owns into one
 * JSON-serialisable bundle: contacts, properties, events/signals, comms, and the
 * ownership-history trail. This is the "can the agent leave with their data
 * tomorrow?" deliverable (CLAUDE.md hard rule #1).
 *
 * Every read is paginated with .range() because PostgREST caps each read at 1000
 * rows regardless of role — a sovereign export must be COMPLETE, so we page to
 * exhaustion with a stable `id` order rather than trusting a single select.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const PAGE = 1000

export interface ExportBundle {
  exported_at: string
  workspace_id: string
  scope: 'account' | 'own'
  agent_id: string | null
  counts: Record<string, number>
  data: {
    contacts: unknown[]
    properties: unknown[]
    events: unknown[]
    email_sends: unknown[]
    ownership_history: unknown[]
  }
}

type QueryBuilder = (q: ReturnType<ReturnType<SupabaseClient['from']>['select']>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any

/** Page a table to exhaustion. `build` applies filters + a stable order. */
async function fetchAllRows(
  admin: SupabaseClient,
  table: string,
  build: QueryBuilder,
): Promise<unknown[]> {
  const out: unknown[] = []
  let from = 0
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base = (admin.from(table as any).select('*') as any).range(from, from + PAGE - 1)
    const { data, error } = await build(base)
    if (error) throw error
    const rows = (data as unknown[]) ?? []
    out.push(...rows)
    if (rows.length < PAGE) break
    from += PAGE
  }
  return out
}

function bundle(
  workspaceId: string,
  scope: 'account' | 'own',
  agentId: string | null,
  parts: ExportBundle['data'],
): ExportBundle {
  return {
    exported_at: new Date().toISOString(),
    workspace_id: workspaceId,
    scope,
    agent_id: agentId,
    counts: Object.fromEntries(
      Object.entries(parts).map(([k, v]) => [k, (v as unknown[]).length]),
    ),
    data: parts,
  }
}

/** Whole-account export (Admin). Everything the workspace owns. */
export async function buildAccountExport(
  admin: SupabaseClient,
  workspaceId: string,
): Promise<ExportBundle> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byWs = (q: any) => q.eq('workspace_id', workspaceId).order('id')
  const [contacts, properties, events, email_sends, ownership_history] = await Promise.all([
    fetchAllRows(admin, 'contacts', byWs),
    fetchAllRows(admin, 'properties', byWs),
    fetchAllRows(admin, 'events', byWs),
    fetchAllRows(admin, 'email_sends', byWs),
    fetchAllRows(admin, 'ownership_history', byWs),
  ])
  return bundle(workspaceId, 'account', null, {
    contacts,
    properties,
    events,
    email_sends,
    ownership_history,
  })
}

/**
 * Single-agent scope export. The agent's owned contacts, the properties they're
 * listed on (primary or co-agent, via property_agents), their attributed events,
 * their sends, and the ownership-history trail touching them.
 */
export async function buildScopeExport(
  admin: SupabaseClient,
  workspaceId: string,
  agentId: string,
): Promise<ExportBundle> {
  // Properties this agent is listed on (Phase 6 source of truth).
  const { data: pa } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('property_agents' as any)
    .select('property_id')
    .eq('agent_id', agentId)
  const propIds = Array.from(
    new Set(((pa as Array<{ property_id: string }> | null) ?? []).map((r) => r.property_id)),
  )

  const [contacts, properties, events, email_sends, ownership_history] = await Promise.all([
    fetchAllRows(admin, 'contacts', (q) =>
      q.eq('workspace_id', workspaceId).or(`owner_agent_id.eq.${agentId},agent_id.eq.${agentId}`).order('id'),
    ),
    propIds.length
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fetchAllRows(admin, 'properties', (q: any) => q.in('id', propIds).order('id'))
      : Promise.resolve([]),
    fetchAllRows(admin, 'events', (q) =>
      q.eq('workspace_id', workspaceId).eq('attributed_agent_id', agentId).order('id'),
    ),
    fetchAllRows(admin, 'email_sends', (q) =>
      q.eq('workspace_id', workspaceId).eq('agent_id', agentId).order('id'),
    ),
    fetchAllRows(admin, 'ownership_history', (q) =>
      q.eq('workspace_id', workspaceId).or(`to_agent_id.eq.${agentId},from_agent_id.eq.${agentId}`).order('id'),
    ),
  ])

  return bundle(workspaceId, 'own', agentId, {
    contacts,
    properties,
    events,
    email_sends,
    ownership_history,
  })
}
