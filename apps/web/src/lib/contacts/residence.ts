/**
 * Server-side helper for the `residence` field on contact create/update.
 *
 * The contact form (and any future surface) sends a SelectedAddress shape
 * captured from <AddressAutocomplete>. This helper:
 *   - Validates the shape (loosely — anything missing is null).
 *   - Calls `resolve_residence_property` to dedup/insert and get a property id.
 *   - Returns the id, or null if the address is effectively empty.
 *
 * The RPC was updated in HOR-117 to accept Google place_id + lat/lng as
 * optional trailing args. database.types.ts wasn't regenerated in that
 * slice (the type file still describes the 7-arg signature), so we cast
 * the args object through `unknown` to bypass the stale type check.
 *
 * NB: lat/lng come over the wire as numbers and Supabase converts to
 * the function's decimal(10,7) — no client-side rounding needed.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface SelectedAddressInput {
  google_place_id?: string | null
  latitude?: number | null
  longitude?: number | null
  street_number?: string | null
  street_name?: string | null
  suburb?: string | null
  state?: string | null
  postcode?: string | null
  /** Free-text fallback (e.g. when user typed but didn't select). */
  formatted?: string | null
}

/**
 * Resolve a residence address to a property id via the Phase 2c / Address v2 RPC.
 *
 * @returns the property id, or `null` if the input is effectively empty
 *   (no place_id, no structured components, no raw fallback).
 */
export async function resolveResidence(
  admin: SupabaseClient,
  workspaceId: string,
  input: SelectedAddressInput | null,
): Promise<{ propertyId: string | null; error: string | null }> {
  if (!input) return { propertyId: null, error: null }

  const args = {
    p_workspace_id:    workspaceId,
    p_street_number:   input.street_number   ?? null,
    p_street_name:     input.street_name     ?? null,
    p_suburb:          input.suburb          ?? null,
    p_state:           input.state           ?? null,
    p_postcode:        input.postcode        ?? null,
    p_raw:             input.formatted       ?? null,
    p_google_place_id: input.google_place_id ?? null,
    p_latitude:        input.latitude        ?? null,
    p_longitude:       input.longitude       ?? null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await admin.rpc('resolve_residence_property' as any, args as any)

  if (error) {
    return { propertyId: null, error: error.message }
  }
  return { propertyId: (data as string | null) ?? null, error: null }
}
