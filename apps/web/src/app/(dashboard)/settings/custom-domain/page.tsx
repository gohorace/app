/**
 * HOR-204 — /settings/custom-domain
 *
 * Server-rendered custom-domain management page. Owner/admin only.
 * Hands the fetched row off to the client CustomDomainManager for
 * polling + mutations.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SectionHeading } from '@/components/ui/section-heading'
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
  dns_provider: 'cloudflare' | 'route53' | 'namecheap' | 'godaddy' | 'vercel' | 'other' | 'unknown' | null
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
      <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
        <div className="p-4 md:p-8 max-w-[660px] space-y-5">
          <SectionHeading title="Custom domain" description="Run Doorstep on your own branded URL." />
          <p className="text-sm text-[var(--fg-secondary)]">You don&apos;t belong to a workspace yet.</p>
        </div>
      </div>
    )
  }

  if (membership.role !== 'owner' && membership.role !== 'admin') {
    return (
      <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
        <div className="p-4 md:p-8 max-w-[660px] space-y-5">
          <SectionHeading title="Custom domain" description="Run Doorstep on your own branded URL." />
          <p className="text-sm text-[var(--fg-secondary)]">Custom domains are managed by the workspace owner.</p>
        </div>
      </div>
    )
  }

  const workspaceId = membership.workspace_id

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
        verificationRecords: Array.isArray(row.verification_records) ? row.verification_records : [],
        dnsProvider: row.dns_provider ?? 'unknown',
        errorMessage: row.error_message,
        createdAt: row.created_at,
        verifiedAt: row.verified_at,
      }
    : null

  // Own scroll container — dashboard <main> delegates scrolling per page (HOR-297).
  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-4 md:p-8 max-w-[660px] space-y-5">
        <SectionHeading
          title="Custom domain"
          description="Doorstep is the public sign-in surface visitors land on after scanning your inspection QR. Run it on your own branded URL."
        />
        <CustomDomainManager initialDomain={initialDomain} />
      </div>
    </div>
  )
}
