/**
 * /settings/integrations — Server Component.
 *
 * Loads the agent's current agent_integrations row (if any) and hands off
 * to the client manager. Parses ?connected and ?error query params to
 * surface post-callback feedback.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Plug } from 'lucide-react'
import { GmailIntegrationManager } from '@/components/settings/gmail-integration-manager'
import type { AgentIntegrationRow } from '@/lib/email/types'

interface PageProps {
  searchParams: Promise<{ connected?: string; error?: string }>
}

export default async function IntegrationsPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user!.id)
    .not('workspace_id', 'is', null)
    .maybeSingle()

  // Pull the Gmail integration row (if any). Slice A's tables aren't in
  // the generated types yet, so we annotate manually.
  let integration: AgentIntegrationRow | null = null
  if (agent?.id) {
    const { data } = await admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('agent_integrations' as any)
      .select(
        'id, workspace_id, agent_id, provider, status, external_account, scope, vault_secret_id, last_refreshed_at, last_error, connected_at, disconnected_at, updated_at'
      )
      .eq('agent_id', agent.id)
      .eq('provider', 'gmail')
      .maybeSingle()
    integration = (data as AgentIntegrationRow | null) ?? null
  }

  const params = await searchParams
  const banner = resolveBanner(params)

  // Own scroll container — dashboard <main> delegates scrolling per page (HOR-297).
  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-8 space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
          <p className="text-muted-foreground">
            Connect external services so Horace can act on your behalf — like sending tracked email from your Gmail account.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plug className="w-4 h-4" />
              Gmail
            </CardTitle>
            <CardDescription>
              Send tracked emails to contacts from your Gmail account. We ask only for the{' '}
              <code className="text-[0.85em]">gmail.send</code> scope — Horace cannot read your inbox.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GmailIntegrationManager integration={integration} banner={banner} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

type BannerKind = 'success' | 'workspace_admin_blocked' | 'refresh_revoked' | 'consent_denied' | 'invalid_state' | 'unexpected' | null

export interface IntegrationBanner {
  kind: Exclude<BannerKind, null>
  message: string
}

function resolveBanner(params: { connected?: string; error?: string }): IntegrationBanner | null {
  if (params.connected === '1') {
    return {
      kind: 'success',
      message: 'Gmail connected. You can now send tracked emails from inside Horace.',
    }
  }
  if (!params.error) return null
  switch (params.error) {
    case 'workspace_admin_blocked':
      return {
        kind: 'workspace_admin_blocked',
        message:
          'Your Google Workspace admin has blocked third-party app access. Ask them to allow Horace, or use a personal Gmail account.',
      }
    case 'refresh_revoked':
      return {
        kind: 'refresh_revoked',
        message:
          'Google revoked the connection before it could be saved. This is usually transient — try Connect Gmail again.',
      }
    case 'consent_denied':
      return {
        kind: 'consent_denied',
        message: 'Consent was cancelled. No worries — try again when you’re ready.',
      }
    case 'invalid_state':
      return {
        kind: 'invalid_state',
        message:
          'The connection link expired or was tampered with. Start the connect flow again to get a fresh link.',
      }
    default:
      return {
        kind: 'unexpected',
        message: 'Something went wrong on our side. Try again, and if it keeps failing let us know.',
      }
  }
}
