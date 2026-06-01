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
    // h-full + overflow-y-auto so long content scrolls inside the
    // overflow-hidden dashboard shell; pb-24 on mobile clears the fixed
    // bottom tab bar (reset on md+ where the bar is hidden).
    <div className="h-full overflow-y-auto p-8 pb-24 md:pb-8 space-y-6">
      <div>
        <h1 className="font-display font-semibold tracking-tight" style={{ fontSize: '26px', color: '#1A1612' }}>
          Import contacts
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Upload a CSV to sync your contacts with Horace.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-sans text-base font-semibold">CSV import</CardTitle>
          <CardDescription>
            Export your contacts as a CSV from any CRM and upload here. Existing contacts are matched
            by email and updated; new ones are created.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ImportForm />
        </CardContent>
      </Card>

      {imports && imports.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-sans text-base font-semibold">Import history</CardTitle>
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
                      <span className="font-medium" style={{ color: '#3D5246' }}>{imp.created_count ?? 0} new</span>
                      {' · '}
                      <span className="text-muted-foreground">{imp.matched_count ?? 0} updated</span>
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
