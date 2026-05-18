/**
 * HOR-204 — /settings/custom-domain
 *
 * Server-rendered custom-domain management page. Owner/admin only.
 * Hands the fetched row off to the client CustomDomainManager for
 * polling + mutations.
 *
 * `workspace_custom_domains` isn't in database.types.ts yet — local row
 * interface + as-any cast. Regenerate types post-merge to clean this up.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Globe } from 'lucide-react'
import { CustomDomainManager, type CustomDomainRow } from '@/components/settings/custom-domain-manager'

export const dynamic = 'force-dynamic'

interface DomainRowFromDb {
  id: string
  workspace_id: string
  hostname: string
  status: 'pending' | 'verifying' | 'verified' | 'failed' | 'removed'
  ssl_status: 'pending' | 'provisioning' | 'active' | 'failed'
  dns_target: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  verification_records: any
  error_message: string | null
  created_at: string
  verified_at: string | null
}

export default async function CustomDomainSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', user!.id)
    .maybeSingle()

  if (!membership) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight">Custom domain</h1>
        <p className="text-muted-foreground mt-2">
          You don&apos;t belong to a workspace yet.
        </p>
      </div>
    )
  }

  if (membership.role !== 'owner' && membership.role !== 'admin') {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight">Custom domain</h1>
        <p className="text-muted-foreground mt-2">
          Custom domains are managed by the workspace owner.
        </p>
      </div>
    )
  }

  const workspaceId = membership.workspace_id

  // Most recent row that isn't 'removed' — that's the active row to
  // render. If only removed rows exist, show the empty state.
  const { data: rowsRaw } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('workspace_custom_domains' as any)
    .select('*')
    .eq('workspace_id', workspaceId)
    .neq('status', 'removed')
    .order('created_at', { ascending: false })
    .limit(1)

  const row = (rowsRaw as DomainRowFromDb[] | null)?.[0] ?? null

  const initialDomain: CustomDomainRow | null = row
    ? {
        id: row.id,
        hostname: row.hostname,
        status: row.status,
        sslStatus: row.ssl_status,
        dnsTarget: row.dns_target,
        verificationRecords: Array.isArray(row.verification_records)
          ? row.verification_records
          : [],
        errorMessage: row.error_message,
        createdAt: row.created_at,
        verifiedAt: row.verified_at,
      }
    : null

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Custom domain</h1>
        <p className="text-muted-foreground">
          Doorstep runs on a domain your attendees recognise. Add a subdomain
          like <code className="font-mono text-xs">inspections.agentname.com.au</code>
          {' '}and we&apos;ll handle the certificate.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-4 h-4" />
            Doorstep domain
          </CardTitle>
          <CardDescription>
            One verified domain per workspace. Add a CNAME with your DNS host;
            we provision the certificate automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustomDomainManager initialDomain={initialDomain} />
        </CardContent>
      </Card>
    </div>
  )
}
