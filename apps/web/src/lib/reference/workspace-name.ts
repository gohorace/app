import 'server-only'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

/**
 * Workspace name for the reference-tables breadcrumb (`horace_intel / <name>`).
 *
 * The substrate header originally read `horace_intel / public` (the Postgres
 * schema name from the design prototype) — but to a user "public" reads as
 * "this data is public", which it is not. We show the workspace name instead.
 *
 * Takes the already-resolved workspace id (the page resolves the primary agent
 * once via `resolvePrimaryAgent`) so we don't re-derive it. Falls back to a
 * neutral `workspace` label.
 */
export async function getWorkspaceName(
  admin: Admin,
  workspaceId: string | null,
): Promise<string> {
  if (!workspaceId) return 'workspace'
  const { data } = await admin
    .from('workspaces')
    .select('name')
    .eq('id', workspaceId)
    .maybeSingle()
  return data?.name?.trim() || 'workspace'
}
