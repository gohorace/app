import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

/**
 * Workspace name for the reference-tables breadcrumb (`horace_intel / <name>`).
 *
 * The substrate header originally read `horace_intel / public` (the Postgres
 * schema name from the design prototype) — but to a user "public" reads as
 * "this data is public", which it is not. We show the workspace name instead.
 *
 * Uses `resolvePrimaryAgent` rather than a bare `.eq('user_id').maybeSingle()`
 * so support-seat / multi-workspace users don't trip the PGRST116 crash.
 * Falls back to a neutral `workspace` label if anything is missing.
 */
export async function getWorkspaceName(): Promise<string> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return 'workspace'

  const admin = createAdminClient()
  const agent = await resolvePrimaryAgent(admin, user.id, { requireWorkspace: true })
  if (!agent?.workspace_id) return 'workspace'

  const { data: ws } = await admin
    .from('workspaces')
    .select('name')
    .eq('id', agent.workspace_id)
    .maybeSingle()

  return ws?.name?.trim() || 'workspace'
}
