/**
 * HOR-321 · Public API v1 — internal rows → public resource shapes.
 *
 * The public contract is a stable PROJECTION over internal columns. Internal
 * enums can drift (new ingestion methods, new event types) without breaking
 * the API: the mapping lives here and only here. We expose *what Horace
 * learned* (facts), never *how* (scores, sessions, intent).
 */
import { encodeId } from './ids'

// ── Public types ────────────────────────────────────────────────────────────

export type ContactSource =
  | 'doorstep_buyer_enquiry'
  | 'doorstep_appraisal_request'
  | 'manual'
  | 'api'
  | 'crm_sync'

export type RelationshipType =
  | 'doorstep_buyer_enquiry'
  | 'doorstep_appraisal_request'
  | 'website_engagement'

export interface PublicContact {
  id: string
  email: string | null
  phone: string | null
  first_name: string | null
  last_name: string | null
  source: ContactSource
  created_at: string
  updated_at: string
  external_ids: Record<string, string>
}

export interface PublicProperty {
  id: string
  gnaf_id: string | null
  address: {
    full: string
    street: string
    suburb: string | null
    state: string | null
    postcode: string | null
  }
  created_at: string
}

export interface PublicRelationship {
  id: string
  contact_id: string
  property_id: string
  type: RelationshipType
  first_engaged_at: string
  last_engaged_at: string
  engagement_count: number
}

// ── Input rows (the columns the routes select) ───────────────────────────────

export interface ContactRow {
  id: string
  email: string | null
  phone: string | null
  first_name: string | null
  last_name: string | null
  source: string | null
  ingestion_method: string | null
  external_ids: unknown
  created_at: string
  updated_at: string
}

export interface PropertyRow {
  id: string
  gnaf_address_detail_pid: string | null
  street_number: string | null
  street_name: string | null
  suburb: string | null
  state: string | null
  postcode: string | null
  created_at: string
}

export interface EngagementRow {
  id: string
  contact_id: string
  property_id: string
  type: string
  first_engaged_at: string
  last_engaged_at: string
  engagement_count: number
}

// ── Projections ──────────────────────────────────────────────────────────────

/**
 * Project the internal capture method onto the public contact source. The
 * public enum is coarse by design — the API doesn't reveal Horace's internal
 * surface taxonomy. Anything that arrived as a prospect through a Horace
 * surface (embed, inspection, portal enquiry, identified visit) buckets to
 * `doorstep_buyer_enquiry`; CRM syncs to `crm_sync`; bulk/manual to `manual`;
 * API-pushed to `api`. Appraisal-origin contacts surface as
 * `doorstep_appraisal_request` once appraisal capture exists to set it.
 */
export function projectContactSource(ingestionMethod: string | null): ContactSource {
  switch (ingestionMethod) {
    case 'api':
      return 'api'
    case 'crm_sync_rex':
    case 'crm_sync_agentbox':
    case 'crm_sync_vaultre':
      return 'crm_sync'
    case 'manual':
    case 'csv_import':
      return 'manual'
    case 'inspection_capture':
    case 'embed_capture':
    case 'portal_enquiry':
    case 'identified_visitor':
    case 'form_submit':
      return 'doorstep_buyer_enquiry'
    default:
      // Unknown / null internal method → safest public bucket.
      return 'manual'
  }
}

/** Reverse of {@link projectContactSource}: the internal ingestion methods a
 *  public `source` filter should match. Used by GET /v1/contacts?source=…
 *  `doorstep_appraisal_request` has no producing path yet → matches nothing. */
export function ingestionMethodsForSource(source: ContactSource): string[] {
  switch (source) {
    case 'api':
      return ['api']
    case 'crm_sync':
      return ['crm_sync_rex', 'crm_sync_agentbox', 'crm_sync_vaultre']
    case 'manual':
      // NB: NULL ingestion_method also projects to 'manual' — the route adds
      // an `is.null` clause for this case.
      return ['manual', 'csv_import']
    case 'doorstep_buyer_enquiry':
      return [
        'inspection_capture',
        'embed_capture',
        'portal_enquiry',
        'identified_visitor',
        'form_submit',
      ]
    case 'doorstep_appraisal_request':
      return []
  }
}

function asStringMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val
  }
  return out
}

export function mapContact(row: ContactRow): PublicContact {
  return {
    id: encodeId('con', row.id),
    email: row.email ? row.email.toLowerCase() : null,
    phone: row.phone ?? null,
    first_name: row.first_name ?? null,
    last_name: row.last_name ?? null,
    source: projectContactSource(row.ingestion_method),
    created_at: row.created_at,
    updated_at: row.updated_at,
    external_ids: asStringMap(row.external_ids),
  }
}

/** Compose the display address from structured parts, the same way the list
 *  and map surfaces render it ("12 Maple Street, Paddington QLD 4064"). */
export function composeAddress(row: PropertyRow): PublicProperty['address'] {
  const street = [row.street_number, row.street_name]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' ')
  const tail = [row.suburb, row.state, row.postcode]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' ')
  const full = [street, tail].filter(Boolean).join(', ')
  return {
    full,
    street,
    suburb: row.suburb ?? null,
    state: row.state ?? null,
    postcode: row.postcode ?? null,
  }
}

export function mapProperty(row: PropertyRow): PublicProperty {
  return {
    id: encodeId('prp', row.id),
    gnaf_id: row.gnaf_address_detail_pid ?? null,
    address: composeAddress(row),
    created_at: row.created_at,
  }
}

export function mapRelationship(row: EngagementRow): PublicRelationship {
  return {
    id: encodeId('rel', row.id),
    contact_id: encodeId('con', row.contact_id),
    property_id: encodeId('prp', row.property_id),
    type: row.type as RelationshipType,
    first_engaged_at: row.first_engaged_at,
    last_engaged_at: row.last_engaged_at,
    engagement_count: row.engagement_count,
  }
}
