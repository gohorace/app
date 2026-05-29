import { createClient } from '@/lib/supabase/server'
import { createApiV1Db } from '@/lib/api-v1/db'
import { resolveAdminContext } from '@/lib/api-v1/admin-guard'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConnectionsManager, type ConnectionRow } from '@/components/settings/connections-manager'

const CONNECTION_COLUMNS =
  'id, system, display_name, status, auth_method, inbound_enabled, outbound_enabled, last_synced_at, last_error, connected_at, requested_at, created_at'

export default async function ConnectionsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const db = createApiV1Db()
  const ctx = user ? await resolveAdminContext(db, user.id) : null
  const isAdmin = ctx?.isAdmin ?? false

  let initial: ConnectionRow[] = []
  if (ctx && isAdmin) {
    const { data } = await db
      .from('crm_connections')
      .select(CONNECTION_COLUMNS)
      .eq('workspace_id', ctx.workspaceId)
      .order('created_at', { ascending: true })
    initial = (data as ConnectionRow[] | null) ?? []
  }

  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-8 space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Connections</h1>
          <p className="text-muted-foreground">Hook Horace up to the CRM you already use.</p>
        </div>

        {isAdmin ? (
          <ConnectionsManager initialConnections={initial} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Connections</CardTitle>
              <CardDescription>
                Your agency&apos;s admins handle connections. Ask one of them to hook up your CRM.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </div>
  )
}
