import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'
import { ReferenceTables } from '@/components/reference/reference-tables'
import { AddPropertyButton } from '@/components/properties/add-property-button'
import { loadReferenceProperties } from '@/lib/reference/load-properties'
import { getWorkspaceName } from '@/lib/reference/workspace-name'

/* Reference tables (substrate layer) — read-only properties table.
 *
 * Real data: base rows from `properties`, `views_7d`/`visitors`/`last_viewed`
 * and the top-viewer score from the get_reference_property_engagement_7d RPC;
 * `top_signal` derived from the strongest viewer intent. Properties are
 * workspace-scoped (no agent_id). */

export const dynamic = 'force-dynamic'

export default async function PropertiesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const agent = user ? await resolvePrimaryAgent(admin, user.id, { requireWorkspace: true }) : null

  const properties = agent?.workspace_id
    ? await loadReferenceProperties(admin, { workspaceId: agent.workspace_id })
    : []
  const workspaceName = await getWorkspaceName(admin, agent?.workspace_id ?? null)

  return (
    <ReferenceTables
      properties={properties}
      workspaceName={workspaceName}
      headerAction={<AddPropertyButton />}
    />
  )
}
