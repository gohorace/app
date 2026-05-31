/**
 * HOR-350 · "Surfaced in your Stream" resolver.
 *
 * Finds the most relevant stream moment to link a property back to. Two
 * sources, in priority order:
 *
 *   1. **Tagged** — a notification_log row whose `property_id` IS this property
 *      (set at flag time for property-subject moments, e.g. inspection capture).
 *      Precise: the moment is unambiguously about this property.
 *   2. **Contact fallback** — the most recent stream-eligible moment for any of
 *      the property's circling contacts. Covers moment types we can't cleanly
 *      tag at write time (form submit, portal enquiry — neither the scoring
 *      engine nor the inbound router has a resolved property_id in scope), so
 *      the link works for them today and tightens as more rows get tagged.
 *
 * The page (HOR-351) uses the returned `{ id, sentAt }` for the link href
 * (`/stream/<id>`) and the relative "· N days ago" stamp.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface SurfacedMoment {
  id: string
  sentAt: string
}

export interface SurfacedRow {
  id: string
  sent_at: string
}

/**
 * Stream-eligible alert types — the contact-fallback only considers rows that
 * `deriveMomentType` would render, so the link never points at an audit-only
 * or channel row that the permalink page would 404 on.
 */
export const STREAM_ELIGIBLE_ALERT_TYPES = [
  'alert_form_submit',
  'alert_portal_enquiry',
  'alert_inspection_capture',
  'alert_inspection_revisit',
  'alert_score_threshold',
  'alert_return_visit',
  'alert_embed_capture',
] as const

/**
 * Pure chooser: prefer the property-tagged row (precise); otherwise the
 * contact-fallback row. Returns null when neither exists.
 */
export function pickSurfacedMoment(
  tagged: SurfacedRow | null,
  fallback: SurfacedRow | null,
): SurfacedMoment | null {
  const chosen = tagged ?? fallback
  return chosen ? { id: chosen.id, sentAt: chosen.sent_at } : null
}

/**
 * Resolve the moment this property last surfaced in. `db` should be a
 * service-role/admin client: notification_log.property_id isn't in the
 * generated types yet (regen deferred), so this takes an untyped client.
 */
export async function findPropertySurfacedMoment(opts: {
  db: SupabaseClient
  workspaceId: string
  propertyId: string
  /** Circling contact ids for the fallback; omit/empty to skip the fallback. */
  contactIds?: string[]
}): Promise<SurfacedMoment | null> {
  const { db, workspaceId, propertyId } = opts

  // 1. Tag-first — the precise source. Short-circuit if found.
  const { data: taggedRows } = await db
    .from('notification_log')
    .select('id, sent_at')
    .eq('workspace_id', workspaceId)
    .eq('property_id', propertyId)
    .not('title', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(1)
  const tagged = (taggedRows?.[0] as SurfacedRow | undefined) ?? null
  if (tagged) return pickSurfacedMoment(tagged, null)

  // 2. Contact fallback — most recent stream-eligible moment for a circler.
  const contactIds = opts.contactIds ?? []
  if (contactIds.length === 0) return null

  const { data: fallbackRows } = await db
    .from('notification_log')
    .select('id, sent_at')
    .eq('workspace_id', workspaceId)
    .in('contact_id', contactIds)
    .in('type', STREAM_ELIGIBLE_ALERT_TYPES as unknown as string[])
    .not('title', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(1)
  const fallback = (fallbackRows?.[0] as SurfacedRow | undefined) ?? null
  return pickSurfacedMoment(null, fallback)
}
