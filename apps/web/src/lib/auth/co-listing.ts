/**
 * HOR-380 — Co-listing permission helpers (Phase 6 of the Access Control epic).
 *
 * Many-to-many property <-> agent via `property_agents`. A property's agents
 * (primary + co-agents) all see its signals and can act on its contacts. This
 * module is the permission layer; the data layer + visibility live in migration
 * 20260602000007.
 *
 * LAUNCH GATE: co-listing must not be exposed to users until the Product
 * double-contact nudge ("Sam already reached out Tuesday") exists. The whole
 * layer is inert until a non-primary co-agent row is created — and the action
 * that creates one is gated behind {@link CO_LISTING_ENABLED}, which stays
 * false until the nudge ships. Do NOT flip this without the nudge.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Actor } from './capabilities'

/**
 * Master gate for the user-facing co-listing flow (add/remove a co-agent).
 * Keep FALSE until the Product double-contact nudge ships (HOR-380 spec).
 */
export const CO_LISTING_ENABLED = false

export interface PropertyAgentRow {
  agentId: string
  role: 'primary' | 'co'
  isPrimary: boolean
}

/**
 * Pure decision: may an actor act on a property, given the property's agent set?
 * Admin acts on the whole account; anyone listed on the property (primary or
 * co-agent) may act on it. Extracted from the async fetch so it unit-tests
 * without a database.
 */
export function decideCanActOnProperty(input: {
  isAdmin: boolean
  actorAgentId: string | null
  propertyAgentIds: string[]
}): boolean {
  if (input.isAdmin) return true
  if (!input.actorAgentId) return false
  return input.propertyAgentIds.includes(input.actorAgentId)
}

/** All agents on a property (primary + co-agents). */
export async function agentsForProperty(
  admin: SupabaseClient,
  propertyId: string,
): Promise<PropertyAgentRow[]> {
  const { data } = await admin
    // property_agents isn't in the generated types yet (regen deferred).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('property_agents' as any)
    .select('agent_id, role, is_primary')
    .eq('property_id', propertyId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data as any[]) ?? []).map((r) => ({
    agentId: r.agent_id as string,
    role: (r.role as 'primary' | 'co') ?? 'co',
    isPrimary: !!r.is_primary,
  }))
}

/**
 * May `actor` act on `propertyId`? Admin → yes; otherwise the actor's agent must
 * be listed on the property (primary or co-agent). Co-listing-aware counterpart
 * of {@link Actor.canActOnAgentScope} for property-scoped actions. Routes adopt
 * this where a property action should be shared across co-listing agents.
 */
export async function agentCanActOnProperty(
  admin: SupabaseClient,
  actor: Actor,
  propertyId: string,
): Promise<boolean> {
  if (actor.isAdmin) return true
  const agents = await agentsForProperty(admin, propertyId)
  return decideCanActOnProperty({
    isAdmin: actor.isAdmin,
    actorAgentId: actor.agentId,
    propertyAgentIds: agents.map((a) => a.agentId),
  })
}

/**
 * Property ids where one of `agentIds` is a CO-agent (is_primary = false).
 * Mirrors the RLS widening clause on `contacts` — the set that grants shared
 * contact visibility. Empty until co-agent rows exist (the launch gate).
 */
export async function coListedPropertyIdsFor(
  admin: SupabaseClient,
  agentIds: string[],
): Promise<string[]> {
  if (agentIds.length === 0) return []
  const { data } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('property_agents' as any)
    .select('property_id')
    .in('agent_id', agentIds)
    .eq('is_primary', false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Array.from(new Set(((data as any[]) ?? []).map((r) => r.property_id as string)))
}

/**
 * The property's shared contact roster — contacts that live at the property
 * (`residence_property_id`) regardless of which agent owns each. This is the
 * "single shared contact history on the property" the double-contact nudge reads
 * from. Call with the service client; the caller scopes by property.
 */
export async function fetchPropertyContacts(
  admin: SupabaseClient,
  propertyId: string,
): Promise<Array<{ id: string; ownerAgentId: string | null }>> {
  const { data } = await admin
    .from('contacts')
    .select('id, owner_agent_id')
    .eq('residence_property_id', propertyId)
    .is('deleted_at', null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data as any[]) ?? []).map((r) => ({
    id: r.id as string,
    ownerAgentId: (r.owner_agent_id as string | null) ?? null,
  }))
}
