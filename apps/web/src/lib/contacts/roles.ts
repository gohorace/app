import { z } from 'zod'
import type { ContactRole } from '@/lib/design/badges'

/**
 * V1 role persistence. Roles live inside `contacts.metadata` as a
 * `roles[]` array (no schema migration — HOR-122 constraint).
 *
 * Shape:
 *   metadata.roles: Array<{
 *     id:          string  (uuid v4, generated client- or server-side)
 *     type:        'seller' | 'buyer' | 'landlord'  (Engaged is derived, not stored)
 *     property_id: string  (uuid)
 *     date:        string  (ISO 8601, when the role was attached)
 *   }>
 *
 * Only durable roles (seller/buyer/landlord) live here. "Engaged" is computed
 * live from recent property_view events; storing it would invite drift.
 */

export const ContactRoleEntrySchema = z.object({
  id:          z.string().uuid(),
  type:        z.enum(['seller', 'buyer', 'landlord']),
  property_id: z.string().uuid(),
  date:        z.string().datetime({ offset: true }),
})

export type ContactRoleEntry = z.infer<typeof ContactRoleEntrySchema>

export const ContactRolesArraySchema = z.array(ContactRoleEntrySchema)

/**
 * Persisted role types — narrower than the badge `ContactRole` since the
 * "engaged" role is never stored, only derived.
 */
export type PersistedRoleType = ContactRoleEntry['type']
export const PERSISTED_ROLE_TYPES: readonly PersistedRoleType[] = ['seller', 'buyer', 'landlord'] as const

/**
 * Safely read roles from contact.metadata. Strips anything that doesn't
 * match the schema — corrupt metadata (e.g. a CSV import that wrote
 * something weird) becomes an empty list rather than a crash.
 */
export function getRoles(metadata: unknown): ContactRoleEntry[] {
  if (!metadata || typeof metadata !== 'object') return []
  const raw = (metadata as Record<string, unknown>).roles
  if (!Array.isArray(raw)) return []
  const out: ContactRoleEntry[] = []
  for (const item of raw) {
    const parsed = ContactRoleEntrySchema.safeParse(item)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

/**
 * Count roles by type for grid badges. Used by the contacts grid row.
 */
export function roleCounts(roles: ContactRoleEntry[]): Record<ContactRole, number> {
  const counts: Record<ContactRole, number> = { seller: 0, buyer: 0, landlord: 0, engaged: 0 }
  for (const r of roles) counts[r.type]++
  return counts
}

/**
 * Build a new metadata object with the given role added (id is generated
 * if not provided). Does NOT mutate — returns a fresh metadata object that
 * can be safely PATCHed back to Supabase via merge update.
 */
export function withRoleAdded(
  metadata: unknown,
  role: { type: PersistedRoleType; property_id: string; date?: string },
): Record<string, unknown> {
  const base = (metadata && typeof metadata === 'object')
    ? { ...(metadata as Record<string, unknown>) }
    : {}
  const existing = getRoles(metadata)
  const next: ContactRoleEntry = {
    id:          crypto.randomUUID(),
    type:        role.type,
    property_id: role.property_id,
    date:        role.date ?? new Date().toISOString(),
  }
  // Idempotency: if a role of the same type already exists on this property,
  // replace it rather than duplicating. (A contact can be Seller of property
  // X only once.)
  const filtered = existing.filter(
    (r) => !(r.type === next.type && r.property_id === next.property_id),
  )
  return { ...base, roles: [...filtered, next] }
}

/**
 * Build a new metadata object with the given role removed.
 */
export function withRoleRemoved(
  metadata: unknown,
  roleId: string,
): Record<string, unknown> {
  const base = (metadata && typeof metadata === 'object')
    ? { ...(metadata as Record<string, unknown>) }
    : {}
  const existing = getRoles(metadata)
  return { ...base, roles: existing.filter((r) => r.id !== roleId) }
}

/**
 * Validate a request-body roles payload before persisting. Returns the
 * parsed array or throws via the zod schema.
 */
export function parseRolesPayload(input: unknown): ContactRoleEntry[] {
  return ContactRolesArraySchema.parse(input)
}
