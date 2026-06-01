import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'
import { ReferenceTables } from '@/components/reference/reference-tables'
import { loadReferenceContacts } from '@/lib/reference/load-contacts'
import { getWorkspaceName } from '@/lib/reference/workspace-name'

/* Reference tables (substrate layer) — read-only contacts table.
 *
 * Real data: base columns from `contacts`, `intent`/`signal` derived from
 * score (+ role), `sessions_7d` from the get_reference_contact_sessions_7d
 * RPC. The dashboard layout enforces auth + the active-subscription gate;
 * `resolvePrimaryAgent` avoids the support-seat `.maybeSingle()` crash. */

export const dynamic = 'force-dynamic'

export default async function ContactsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const agent = user ? await resolvePrimaryAgent(admin, user.id, { requireWorkspace: true }) : null

  const contacts = agent
    ? await loadReferenceContacts(admin, { agentId: agent.id, workspaceId: agent.workspace_id })
    : []
  const workspaceName = await getWorkspaceName(admin, agent?.workspace_id ?? null)

  return <ReferenceTables contacts={contacts} workspaceName={workspaceName} />
}
