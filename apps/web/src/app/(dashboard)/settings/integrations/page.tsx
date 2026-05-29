/**
 * /settings/integrations — Server Component (HOR-329 unified surface).
 *
 * Consolidates the old Connections + Integrations pages, with email
 * exclusions rehomed beneath the Gmail card. Each sub-feature keeps its
 * own data contract and API routes — this page only composes them:
 *   - Gmail (agent_integrations, agent-scoped) + email exclusions
 *   - CRM connections (crm_connections, workspace/admin-scoped) + concierge
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createApiV1Db } from '@/lib/api-v1/db'
import { resolveAdminContext } from '@/lib/api-v1/admin-guard'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { GmailIntegrationManager } from '@/components/settings/gmail-integration-manager'
import { EmailExclusionsManager } from '@/components/settings/email-exclusions-manager'
import { ConnectionsManager, type ConnectionRow } from '@/components/settings/connections-manager'
import type { AgentIntegrationRow } from '@/lib/email/types'

interface ExclusionRow {
  id: string
  pattern: string
  pattern_kind: 'email' | 'domain'
  reason: string | null
  source: 'agent' | 'seeded' | 'auto_bounce'
  created_at: string
}

interface PageProps {
  searchParams: Promise<{ connected?: string; error?: string }>
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

  // ── Gmail integration + email exclusions (agent-scoped) ──────────────
  // agent_integrations / agent_email_exclusions aren't in generated types
  // yet (HOR-203 / Slice A) — annotate manually.
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
    exclusions = ((exclRes.data ?? []) as unknown as ExclusionRow[]) ?? []
  }

  // ── CRM connections (workspace-scoped, admin only) ───────────────────
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

  const params = await searchParams
  const banner = resolveBanner(params)

  // Own scroll container — dashboard <main> delegates scrolling per page (HOR-297).
  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-4 md:p-8 space-y-8 max-w-2xl">
        <div>
          <h1 className="font-serif text-[22px] font-semibold tracking-tight text-[var(--fg-primary)]">
            Integrations
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            Every service Horace works alongside, in one place.
          </p>
        </div>

        {/* ── Email (Gmail + exclusions) ─────────────────────────────── */}
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Email</h2>
            <p className="text-xs text-[var(--fg-secondary)]">
              Send tracked 1:1 emails to contacts from your Gmail account. Horace asks only for the{' '}
              <code className="text-[0.85em]">gmail.send</code> scope — it cannot read your inbox.
            </p>
          </div>
          <GmailIntegrationManager integration={integration} banner={banner} />

          <div className="pt-2">
            <h3 className="text-sm font-medium text-[var(--fg-primary)]">
              Senders Horace won&apos;t email
            </h3>
            <p className="mb-3 text-xs text-[var(--fg-secondary)]">
              Colleagues, suppliers, and addresses to keep out of automated sends. Horace seeds an
              AU-default list of portal / aggregator domains — you can remove a default if you
              genuinely send to it.
            </p>
            <EmailExclusionsManager initialExclusions={exclusions} />
          </div>
        </section>

        {/* ── CRM connections ────────────────────────────────────────── */}
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Your CRM</h2>
            <p className="text-xs text-[var(--fg-secondary)]">
              Hook Horace up to the CRM you already use.
            </p>
          </div>
          {isAdmin ? (
            <ConnectionsManager initialConnections={connections} />
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
        </section>
      </div>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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
