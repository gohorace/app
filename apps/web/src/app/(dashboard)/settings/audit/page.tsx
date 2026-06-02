/**
 * HOR-374 — /settings/audit
 *
 * Minimal, read-only Admin view of the workspace audit trail. Gated on the
 * canonical Role axis (actor.isAdmin). Renders the most recent entries with the
 * two-identity columns (Actor + Acting as) the audit log exists to preserve.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SectionHeading } from '@/components/ui/section-heading'
import { getActor } from '@/lib/auth/capabilities'

export const dynamic = 'force-dynamic'

interface AuditRow {
  id: string
  actor_agent_id: string | null
  acting_as_agent_id: string | null
  action: string
  resource_type: string
  resource_id: string | null
  scope: string | null
  created_at: string
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-4 md:p-8 max-w-[860px]">
        <SectionHeading
          title="Activity log"
          description="An immutable record of writes, comms, and access changes across the workspace."
        />
        {children}
      </div>
    </div>
  )
}

export default async function AuditSettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const actor = user ? await getActor(admin, user.id, { requireWorkspace: true }) : null

  if (!actor?.workspaceId || !actor.isAdmin) {
    return (
      <Shell>
        <p className="text-sm text-[var(--fg-secondary)]">
          The activity log is available to workspace admins.
        </p>
      </Shell>
    )
  }

  const [{ data: rows }, { data: agents }] = await Promise.all([
    admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('audit_log' as any)
      .select(
        'id, actor_agent_id, acting_as_agent_id, action, resource_type, resource_id, scope, created_at',
      )
      .eq('workspace_id', actor.workspaceId)
      .order('created_at', { ascending: false })
      .limit(100),
    admin
      .from('agents')
      .select('id, first_name, last_name, email')
      .eq('workspace_id', actor.workspaceId),
  ])

  const entries = (rows as AuditRow[] | null) ?? []
  const nameById = new Map<string, string>()
  for (const a of (agents as Array<{ id: string; first_name: string | null; last_name: string | null; email: string | null }> | null) ?? []) {
    const name = [a.first_name, a.last_name].filter(Boolean).join(' ').trim()
    nameById.set(a.id, name || a.email || a.id.slice(0, 8))
  }
  const label = (id: string | null) => (id ? nameById.get(id) ?? id.slice(0, 8) : '—')

  return (
    <Shell>
      {entries.length === 0 ? (
        <p className="text-sm text-[var(--fg-secondary)]">No activity recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-[var(--border-subtle)] text-[var(--fg-tertiary)]">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Acting as</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Resource</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-[var(--border-subtle)] last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--fg-secondary)]">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-[var(--fg-primary)]">{label(e.actor_agent_id)}</td>
                  <td className="px-3 py-2 text-[var(--fg-secondary)]">
                    {e.acting_as_agent_id ? label(e.acting_as_agent_id) : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px] text-[var(--fg-primary)]">{e.action}</td>
                  <td className="px-3 py-2 text-[var(--fg-secondary)]">
                    {e.resource_type}
                    {e.resource_id ? ` · ${e.resource_id.slice(0, 8)}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  )
}
