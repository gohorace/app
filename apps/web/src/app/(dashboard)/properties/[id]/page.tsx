import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  PropertyDetailView,
  type PropertyDetailRoleAttached,
} from '@/components/properties/property-detail-view'
import { deriveIdentity, makeInitials } from '@/lib/contacts/identity'
import { getRoles } from '@/lib/contacts/roles'
import { coercePropertyStatus } from '@/lib/design/badges'
import { fetchPropertySignal } from '@/lib/properties/signal'
import { getCachedPropertyRead } from '@/lib/ai/property-read'

export const dynamic = 'force-dynamic'

export default async function PropertyDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id, first_name, last_name')
    .eq('user_id', user!.id)
    .maybeSingle()

  if (!agent?.workspace_id) notFound()

  const { data: property } = await admin
    .from('properties')
    .select('id, street_number, street_name, suburb, status')
    .eq('id', params.id)
    .eq('workspace_id', agent.workspace_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!property) notFound()

  const address =
    [property.street_number, property.street_name].filter(Boolean).join(' ') ||
    property.suburb ||
    'Address pending'

  const agentName = [agent.first_name, agent.last_name].filter(Boolean).join(' ') || 'Your agent'

  // ── Behavioural derivation (PR1) + "Horace's read" (PR2) ────────────────
  // The deriver does the heavy lifting that this page used to hand-roll
  // (circling, named timeline, moments, change chips, anon sessions,
  // engagement). The read is cached + best-effort.
  const signal = await fetchPropertySignal({
    db: admin,
    workspaceId: agent.workspace_id,
    propertyId: property.id,
    propertyAddress: address,
  })

  const read = await getCachedPropertyRead({
    agentId: agent.id,
    agentName,
    propertyId: property.id,
    propertyAddress: address,
    signal,
  })

  // ── Role-attached vendors/buyers (durable metadata roles) ───────────────
  // Not part of the behavioural signal — these are the seller/buyer roles the
  // agent has explicitly attached. Kept separate so they render in their own
  // "Role-attached" group above the behaviour-derived "Engaging now".
  const { data: contacts } = await admin
    .from('contacts')
    .select('id, first_name, last_name, email, metadata')
    .eq('agent_id', agent.id)
    .is('deleted_at', null)

  const roleAttached: PropertyDetailRoleAttached[] = []
  for (const c of contacts ?? []) {
    const role = getRoles(c.metadata).find((r) => r.property_id === property.id)
    if (!role) continue
    roleAttached.push({
      contactId: c.id,
      name:      [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'A contact',
      initials:  makeInitials(c),
      identity:  deriveIdentity(c),
      role:      role.type,
      date:      role.date,
    })
  }

  return (
    <PropertyDetailView
      property={{
        id:      property.id,
        address,
        suburb:  property.suburb,
        status:  coercePropertyStatus(property.status),
      }}
      signal={signal}
      read={read}
      roleAttached={roleAttached}
    />
  )
}
