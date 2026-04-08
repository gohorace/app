import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ImportForm } from '@/components/import/import-form'
import { formatDistanceToNow } from 'date-fns'

export default async function ImportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const { data: imports } = agent
    ? await admin
        .from('crm_imports')
        .select('id, filename, row_count, created_count, matched_count, skipped_count, status, created_at')
        .eq('agent_id', agent.id)
        .order('created_at', { ascending: false })
        .limit(10)
    : { data: [] }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Import CRM</h1>
        <p className="text-muted-foreground">Upload a Rex CRM CSV export to sync your contacts</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rex CRM import</CardTitle>
          <CardDescription>
            In Rex, go to <strong>Contacts → Export</strong> and download as CSV. Upload it here —
            existing contacts are matched by email and updated; new ones are created.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ImportForm />
        </CardContent>
      </Card>

      {imports && imports.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Import history</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {imports.map((imp) => (
                <div key={imp.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{imp.filename ?? 'Unknown file'}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(imp.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <p className="text-sm tabular-nums">
                      <span className="text-green-700 font-medium">{imp.created_count ?? 0} new</span>
                      {' · '}
                      <span className="text-blue-700">{imp.matched_count ?? 0} updated</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{imp.row_count ?? 0} total rows</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
