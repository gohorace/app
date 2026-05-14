/**
 * Doorstep inspections — repo helpers.
 *
 * Single typed surface for the four operations HOR-148..HOR-152 need:
 *
 *   - createInspection  — agent creates one from /inspections/new
 *   - listForAgent      — agent's list view at /inspections
 *   - getByToken        — public capture page resolves /i/<token>
 *   - captureScan       — public capture endpoint stitches a submission
 *
 * Implementation notes:
 *
 * - HOR-146 ships the schema; `database.types.ts` regen is a follow-up
 *   commit on that branch. Until it lands, we use the local row types
 *   in ./types.ts and call `.from('inspections' as never)` to silence
 *   the auto-generated overloads. Strip the casts after types regen.
 *
 * - `captureScan` is a thin wrapper over the `stitch_contact_from_inspection`
 *   RPC (see HOR-147 migration). The RPC does all four writes
 *   transactionally; this helper just shapes the payload and types the
 *   return.
 *
 * - All functions take an admin-shaped client because the capture path
 *   runs without an authenticated session (public form). Agent UI calls
 *   should still pass the service-role client; RLS protects the
 *   authenticated-side reads at the API layer.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { Inspection, InspectionCaptureResult } from './types'

type AdminClient = SupabaseClient<Database>

// ─────────────────────────────────────────────────────────────────────────────
// createInspection
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateInspectionInput {
  workspaceId: string
  agentId: string
  propertyId: string
  /** ISO timestamp. */
  scheduledAt: string
  /** Optional ISO timestamp; null = open-ended window. */
  windowEndAt?: string | null
  /** Pre-generated token via `tokens.generate()`. */
  token: string
}

/**
 * Insert a new inspection. v1 forces `inspection_type='open_home'`; the
 * column default makes the explicit value redundant, but we set it so
 * future readers don't have to chase the default through the migration.
 *
 * On UNIQUE token collision (1-in-218-trillion), the caller is expected
 * to retry with a fresh `tokens.generate()`. Cheaper than a pre-flight
 * existence check.
 */
export async function createInspection(
  supabase: AdminClient,
  input: CreateInspectionInput,
): Promise<Inspection> {
  const { data, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('inspections' as never)
    .insert({
      workspace_id: input.workspaceId,
      agent_id: input.agentId,
      property_id: input.propertyId,
      inspection_type: 'open_home',
      token: input.token,
      scheduled_at: input.scheduledAt,
      window_end_at: input.windowEndAt ?? null,
      status: 'scheduled',
    } as never)
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(`createInspection failed: ${error?.message ?? 'unknown'}`)
  }
  return data as unknown as Inspection
}

// ─────────────────────────────────────────────────────────────────────────────
// listForAgent
// ─────────────────────────────────────────────────────────────────────────────

export interface ListForAgentResult {
  upcoming: Inspection[]
  past: Inspection[]
}

/**
 * Agent's `/inspections` dashboard view. Splits on `scheduled_at` vs now
 * so the UI can render two sections without re-querying. Soft-deleted
 * rows are excluded; cancelled rows show in `past` (they happened, the
 * agent should still see they happened).
 */
export async function listForAgent(
  supabase: AdminClient,
  agentId: string,
  opts: { limit?: number } = {},
): Promise<ListForAgentResult> {
  const limit = opts.limit ?? 50
  const nowIso = new Date().toISOString()

  const upcomingQ = supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('inspections' as never)
    .select('*')
    .eq('agent_id', agentId)
    .is('deleted_at', null)
    .gte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(limit)

  const pastQ = supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('inspections' as never)
    .select('*')
    .eq('agent_id', agentId)
    .is('deleted_at', null)
    .lt('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: false })
    .limit(limit)

  const [upcoming, past] = await Promise.all([upcomingQ, pastQ])

  if (upcoming.error) throw new Error(`listForAgent upcoming: ${upcoming.error.message}`)
  if (past.error) throw new Error(`listForAgent past: ${past.error.message}`)

  return {
    upcoming: (upcoming.data ?? []) as unknown as Inspection[],
    past: (past.data ?? []) as unknown as Inspection[],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getByToken
// ─────────────────────────────────────────────────────────────────────────────

export interface ByTokenResult {
  inspection: Inspection
  agent: {
    id: string
    first_name: string | null
    last_name: string | null
    avatar_url: string | null
  }
  property: {
    id: string
    street_number: string | null
    street_name: string | null
    suburb: string | null
    state: string | null
    postcode: string | null
  }
  workspace: {
    id: string
    snippet_key: string | null
  }
}

/**
 * Resolve a public token to the joined shape the capture page (HOR-151)
 * needs to render itself: agent branding + property address + workspace
 * snippet_key for the tracker injection.
 *
 * Returns `null` on missing / soft-deleted / cancelled. The capture
 * page treats null as a 404 with no Horace voice.
 */
export async function getByToken(
  supabase: AdminClient,
  token: string,
): Promise<ByTokenResult | null> {
  const { data, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('inspections' as never)
    .select(
      `
      id, workspace_id, agent_id, property_id, inspection_type,
      token, scheduled_at, window_end_at, status,
      created_at, updated_at, deleted_at,
      agents:agent_id (id, first_name, last_name, avatar_url),
      properties:property_id (id, street_number, street_name, suburb, state, postcode),
      workspaces:workspace_id (id, snippet_key)
    `,
    )
    .eq('token', token)
    .is('deleted_at', null)
    .neq('status', 'cancelled')
    .maybeSingle()

  if (error) {
    // Supabase returns no error for "0 rows" because of .maybeSingle().
    // A real error (bad SQL, RLS denial against an authenticated client) is rare here.
    console.error('[inspections.getByToken]', error)
    return null
  }
  if (!data) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any
  return {
    inspection: {
      id: row.id,
      workspace_id: row.workspace_id,
      agent_id: row.agent_id,
      property_id: row.property_id,
      inspection_type: row.inspection_type,
      token: row.token,
      scheduled_at: row.scheduled_at,
      window_end_at: row.window_end_at,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at,
    },
    agent: row.agents,
    property: row.properties,
    workspace: row.workspaces,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// captureScan
// ─────────────────────────────────────────────────────────────────────────────

export interface CaptureScanInput {
  token: string
  /** E.164 — caller normalises via lib/inspections/phone.toE164 first. */
  phone: string
  name: string
  /** The tracker's `_riq_aid` cookie value. */
  anonymousId: string
  /** UUID of the session the API layer upserted before this call. */
  sessionId: string
  userAgent?: string | null
}

/**
 * Thin wrapper over the `stitch_contact_from_inspection` RPC. All four
 * writes happen server-side in a single transaction; this helper exists
 * mostly to type the response and translate the SQL parameter names to
 * camelCase.
 *
 * On the RPC's `P0002` (token not found / cancelled / soft-deleted),
 * Supabase surfaces an error with code `P0002`. The API layer
 * translates to HTTP 404. All other failures bubble.
 */
export async function captureScan(
  supabase: AdminClient,
  input: CaptureScanInput,
): Promise<InspectionCaptureResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('stitch_contact_from_inspection', {
    p_token: input.token,
    p_phone: input.phone,
    p_name: input.name,
    p_anonymous_id: input.anonymousId,
    p_session_id: input.sessionId,
    p_user_agent: input.userAgent ?? null,
  })

  if (error) {
    // Re-throw — let the API layer inspect `error.code` for P0002.
    throw error
  }
  // RETURNS TABLE → array; we always get exactly one row.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = data as any
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('stitch_contact_from_inspection returned no row')
  }
  return rows[0] as InspectionCaptureResult
}
