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
import { getActor } from '@/lib/auth/capabilities'
import type { ReassignAgentOption } from '@/components/properties/property-reassign-dialog'

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
    .select('id, street_number, street_name, suburb, status, listing_agent_id')
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

  // ── Reassignment affordance (Admin/Manager only — HOR-379) ──────────────
  // Resolved via getActor (multi-workspace safe) rather than the page's legacy
  // single-agent lookup above. Only built when the viewer can assign_properties;
  // Agents/Support never receive the prop, so the control never renders for them.
  const actor = await getActor(admin, user!.id, { requireWorkspace: true })
  let reassign: { currentAgentName: string | null; agents: ReassignAgentOption[] } | undefined
  if (actor?.can('assign_properties') && actor.workspaceId === agent.workspace_id) {
    // Candidate targets: active, real (non-support) agent seats in this workspace.
    const { data: roster } = await admin
      .from('agents')
      // role/seat_type/status aren't in the generated types yet (regen deferred).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select('id, first_name, last_name, role, seat_type, status' as any)
      .eq('workspace_id', agent.workspace_id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (roster as any[]) ?? []
    const currentId = (property as { listing_agent_id?: string | null }).listing_agent_id ?? null
    const agentOptions: ReassignAgentOption[] = rows
      .filter((r) => r.status === 'active' && r.seat_type !== 'support')
      .map((r) => ({
        id: r.id as string,
        name: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unnamed agent',
        role: (r.role as string) ?? 'agent',
        isCurrent: r.id === currentId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    // Name of the current holder — from the full roster, since they may be a
    // departed/support seat that's excluded from the selectable targets.
    const currentRow = currentId ? rows.find((r) => r.id === currentId) : null
    const currentAgentName = currentRow
      ? [currentRow.first_name, currentRow.last_name].filter(Boolean).join(' ') || 'Unnamed agent'
      : null
    reassign = { currentAgentName, agents: agentOptions }
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
      reassign={reassign}
    />
  )
}
