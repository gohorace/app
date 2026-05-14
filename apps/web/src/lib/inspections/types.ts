/**
 * Local row + payload types for the `inspections` and `inspection_scans`
 * tables introduced in HOR-146 (Doorstep v1 schema).
 *
 * These exist because the HOR-146 migration ships ahead of a regenerated
 * `database.types.ts`. Once `pnpm dlx supabase gen types typescript ...`
 * runs (separate commit on the HOR-146 branch), prefer:
 *
 *   import type { Database } from '@/types/database.types'
 *   type Inspection = Database['public']['Tables']['inspections']['Row']
 *
 * and delete this file. The shapes here mirror the migration exactly —
 * keep them in sync if anyone edits the schema before types regen.
 *
 * Generic enough to cover open homes (v1) and private inspections (v2)
 * without a type change.
 */

export type InspectionType = 'open_home' | 'private'

export type InspectionStatus = 'scheduled' | 'live' | 'ended' | 'cancelled'

export interface Inspection {
  id: string
  workspace_id: string
  agent_id: string
  property_id: string
  inspection_type: InspectionType
  token: string
  scheduled_at: string
  window_end_at: string | null
  status: InspectionStatus
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface InspectionScan {
  id: string
  workspace_id: string
  inspection_id: string
  contact_id: string
  captured_at: string
  cookie_id: string | null
}

/**
 * Tuple returned by `stitch_contact_from_inspection(...)` RPC.
 *
 * `is_new_scan` is false on repeat submissions (same contact + same
 * inspection inside the unique constraint). The API layer (HOR-152) uses
 * it to skip dispatching another push notification on a duplicate submit
 * so agents don't see "Horace just met X" buzzing for the same prospect
 * twice in a row.
 */
export interface InspectionCaptureResult {
  contact_id: string
  agent_id: string
  workspace_id: string
  address: string
  contact_name: string
  is_new_scan: boolean
}
