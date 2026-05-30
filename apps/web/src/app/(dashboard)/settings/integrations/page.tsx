/**
 * /settings/integrations — "API & developer access" (HOR-329 unified surface).
 *
 * Fetches Gmail integration + email exclusions + CRM connections server-side,
 * then hands everything to the IntegrationsView client component which renders
 * the ServiceCard-based UI from the design handoff.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createApiV1Db } from '@/lib/api-v1/db'
import { resolveAdminContext } from '@/lib/api-v1/admin-guard'
import { IntegrationsView } from '@/components/settings/integrations-view'
import type { AgentIntegrationRow } from '@/lib/email/types'
import type { ConnectionRow } from '@/components/settings/connections-manager'

export const dynamic = 'force-dynamic'

interface ExclusionRow {
  id: string
  pattern: string
  pattern_kind: 'email' | 'domain'
  reason: string | null
  source: 'agent' | 'seeded' | 'auto_bounce'
  created_at: string
}

type BannerKind =
  | 'success'
  | 'workspace_admin_blocked'
  | 'refresh_revoked'
  | 'consent_denied'
  | 'invalid_state'
  | 'unexpected'

interface IntegrationBanner {
  kind: BannerKind
  message: string
}

const CONNECTION_COLUMNS =
  'id, system, display_name, status, auth_method, inbound_enabled, outbound_enabled, last_synced_at, last_error, connected_at, requested_at, created_at'

interface PageProps {
  searchParams: Promise<{ connected?: string; error?: string }>
}

export default async function IntegrationsPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user!.id)
    .not('workspace_id', 'is', null)
    .maybeSingle()

  // Gmail integration + email exclusions (agent-scoped).
  let integration: AgentIntegrationRow | null = null
  let exclusions: ExclusionRow[] = []
  if (agent?.id) {
    const [gmailRes, exclRes] = await Promise.all([
      admin
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from('agent_integrations' as any)
        .select(
          'id, workspace_id, agent_id, provider, status, external_account, scope, vault_secret_id, last_refreshed_at, last_error, connected_at, disconnected_at, updated_at',
        )
        .eq('agent_id', agent.id)
        .eq('provider', 'gmail')
        .maybeSingle(),
      admin
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from('agent_email_exclusions' as any)
        .select('id, pattern, pattern_kind, reason, source, created_at')
        .eq('agent_id', agent.id)
        .order('source', { ascending: true })
        .order('created_at', { ascending: true }),
    ])
    integration = (gmailRes.data as AgentIntegrationRow | null) ?? null
    exclusions = ((exclRes.data ?? []) as unknown as ExclusionRow[])
  }

  // CRM connections (workspace-scoped, admin only).
  const db = createApiV1Db()
  const ctx = user ? await resolveAdminContext(db, user.id) : null
  const isAdmin = ctx?.isAdmin ?? false
  let connections: ConnectionRow[] = []
  if (ctx && isAdmin) {
    const { data } = await db
      .from('crm_connections')
      .select(CONNECTION_COLUMNS)
      .eq('workspace_id', ctx.workspaceId)
      .order('created_at', { ascending: true })
    connections = (data as ConnectionRow[] | null) ?? []
  }

  // OAuth callback banner.
  const params = await searchParams
  const banner = resolveBanner(params)

  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-4 md:p-8 max-w-[660px]">
        <IntegrationsView
          integration={integration}
          banner={banner}
          exclusions={exclusions}
          connections={connections}
          isAdmin={isAdmin}
        />
      </div>
    </div>
  )
}

function resolveBanner(params: { connected?: string; error?: string }): IntegrationBanner | null {
  if (params.connected === '1') {
    return { kind: 'success', message: 'Gmail connected. You can now send tracked emails from inside Horace.' }
  }
  if (!params.error) return null
  switch (params.error) {
    case 'workspace_admin_blocked':
      return { kind: 'workspace_admin_blocked', message: 'Your Google Workspace admin has blocked third-party app access. Ask them to allow Horace, or use a personal Gmail account.' }
    case 'refresh_revoked':
      return { kind: 'refresh_revoked', message: 'Google revoked the connection before it could be saved. Try Connect Gmail again.' }
    case 'consent_denied':
      return { kind: 'consent_denied', message: 'Consent was cancelled. No worries — try again when you\'re ready.' }
    case 'invalid_state':
      return { kind: 'invalid_state', message: 'The connection link expired or was tampered with. Start the connect flow again.' }
    default:
      return { kind: 'unexpected', message: 'Something went wrong on our side. Try again, and if it keeps failing let us know.' }
  }
}
