/**
 * /settings/api-and-data — "API & developer access" (HOR-329 unified surface).
 *
 * Three subsections per the design handoff:
 *   1. REST API keys  (admin only)
 *   2. MCP — for Claude and other AI clients  (every seat)
 *   3. Your data  (admin only, client-side downloads)
 *
 * Webhooks removed from this view (deferred to a dedicated surface).
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createApiV1Db } from '@/lib/api-v1/db'
import { resolveAdminContext } from '@/lib/api-v1/admin-guard'
import { maskApiV1Key } from '@/lib/api-v1/keys'
import { getAppUrl } from '@/lib/url'
import { SectionHeading } from '@/components/ui/section-heading'
import { ApiAndDataManager, type ApiV1KeyRow } from '@/components/settings/api-and-data-manager'
import { ApiTokensManager } from '@/components/settings/api-tokens-manager'
import { DataExportButtons } from '@/components/settings/data-export-buttons'

export const dynamic = 'force-dynamic'

interface McpTokenRow {
  id: string
  name: string
  client_id: string | null
  client_name: string | null
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

/** Uppercase eyebrow used to separate the three subsections. */
function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-secondary)]">
      {children}
    </div>
  )
}

export default async function ApiAndDataPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // MCP tokens are user-scoped — every seat sees their own.
  const admin = createAdminClient()
  const { data: mcpTokensRaw } = await admin
    .from('workspace_api_tokens')
    .select('id, name, client_id, last_used_at, revoked_at, created_at')
    .eq('user_id', user!.id)
    .eq('kind', 'mcp')
    .order('created_at', { ascending: false })
  const mcpTokensRows = (mcpTokensRaw as Array<Omit<McpTokenRow, 'client_name'>>) ?? []

  // Resolve the human-friendly client name registered by the OAuth client
  // (e.g. "Claude") so the list shows that instead of the opaque client_id.
  const clientIds = [...new Set(mcpTokensRows.map((t) => t.client_id).filter(Boolean))] as string[]
  const clientNames = new Map<string, string>()
  if (clientIds.length > 0) {
    const { data: clients } = await admin
      .from('oauth_clients')
      .select('client_id, client_name')
      .in('client_id', clientIds)
    for (const c of (clients as Array<{ client_id: string; client_name: string | null }> | null) ?? []) {
      if (c.client_name) clientNames.set(c.client_id, c.client_name)
    }
  }
  const mcpTokens: McpTokenRow[] = mcpTokensRows.map((t) => ({
    ...t,
    client_name: t.client_id ? clientNames.get(t.client_id) ?? null : null,
  }))

  // REST keys + export — workspace admin only.
  const db = createApiV1Db()
  const ctx = user ? await resolveAdminContext(db, user.id) : null
  const isAdmin = ctx?.isAdmin ?? false

  let initialKeys: ApiV1KeyRow[] = []
  if (ctx && isAdmin) {
    const { data } = await db
      .from('workspace_api_tokens')
      .select('id, name, key_hint, last_used_at, last_used_ip, revoked_at, created_at')
      .eq('workspace_id', ctx.workspaceId)
      .eq('kind', 'api_v1')
      .order('created_at', { ascending: false })
    initialKeys = ((data as Array<Record<string, unknown>> | null) ?? []).map((k) => ({
      id: k.id as string,
      name: k.name as string,
      masked: maskApiV1Key(k.key_hint as string | null),
      last_used_at: (k.last_used_at as string | null) ?? null,
      last_used_ip: (k.last_used_ip as string | null) ?? null,
      revoked_at: (k.revoked_at as string | null) ?? null,
      created_at: k.created_at as string,
    }))
  }

  const appUrl = getAppUrl()
  const baseUrl = `${appUrl}/api/v1`
  const mcpUrl = appUrl ? `${appUrl}/api/mcp` : ''

  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-4 md:p-8 max-w-[660px] space-y-4">
        <SectionHeading
          title="API & developer access"
          description="Programmatic access to your workspace — REST for your own integrations, MCP for AI clients like Claude."
        />

        {/* 1. REST API keys (admin only) */}
        {isAdmin ? (
          <>
            <SubHead>REST API keys</SubHead>
            <ApiAndDataManager
              initialKeys={initialKeys}
              baseUrl={baseUrl}
              showExport={false}
            />
          </>
        ) : (
          <p className="text-sm text-[var(--fg-secondary)]">
            REST API keys and data export are managed by your workspace admins.
          </p>
        )}

        {/* 2. MCP — every seat manages their own tokens */}
        <SubHead>MCP — for Claude and other AI clients</SubHead>
        <ApiTokensManager initialTokens={mcpTokens} mcpUrl={mcpUrl} />

        {/* 3. Your data (admin only) */}
        {isAdmin && (
          <>
            <SubHead>Your data</SubHead>
            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[22px] shadow-[var(--shadow-sm)]">
              <div className="mb-4 flex gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[rgba(196,98,45,0.1)]">
                  {/* Download icon rendered client-side via DataExportButtons */}
                </div>
                <div>
                  <div className="text-sm font-semibold text-[var(--fg-primary)]">Take your data anywhere</div>
                  <div className="mt-0.5 text-xs leading-snug text-[var(--fg-secondary)]">
                    Your contacts, properties, and relationships — the whole agency dataset. No request, no wait.
                  </div>
                </div>
              </div>
              <DataExportButtons />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
