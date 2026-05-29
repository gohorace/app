/**
 * /settings/api-and-data — "API & developer access" (HOR-329 unified surface).
 *
 * Consolidates the old API tokens (MCP) and API & data (REST keys + webhooks
 * + export) pages. Scope split preserved:
 *   - REST API keys + webhooks + export — workspace/admin (resolveAdminContext)
 *   - MCP tokens — user-scoped (every seat manages their own clients)
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createApiV1Db } from '@/lib/api-v1/db'
import { resolveAdminContext } from '@/lib/api-v1/admin-guard'
import { maskApiV1Key } from '@/lib/api-v1/keys'
import { getAppUrl } from '@/lib/url'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ShieldCheck } from 'lucide-react'
import { ApiAndDataManager, type ApiV1KeyRow } from '@/components/settings/api-and-data-manager'
import { WebhooksManager } from '@/components/settings/webhooks-manager'
import { ApiTokensManager } from '@/components/settings/api-tokens-manager'

interface McpTokenRow {
  id: string
  name: string
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

const COMMITMENTS: Array<{ title: string; body: string }> = [
  {
    title: 'Never sold, never shared',
    body: 'The intelligence Horace builds on your market is yours. It is never sold, shared, or traded — to anyone, for any reason.',
  },
  {
    title: 'Invisible to other agents',
    body: 'What Horace learns for you stays with you. No other agent on the platform can see it.',
  },
  {
    title: 'Never used to train models',
    body: "Your clients' behaviour informs your work and nothing else. It doesn't feed our product, or anyone's models.",
  },
  {
    title: 'Yours to take',
    body: 'Export everything below, any time, in one click. The day you leave, your data comes with you.',
  },
]

export default async function ApiAndDataPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // MCP tokens are user-scoped — every seat sees their own.
  const admin = createAdminClient()
  const { data: mcpTokens } = await admin
    .from('workspace_api_tokens')
    .select('id, name, last_used_at, revoked_at, created_at')
    .eq('user_id', user!.id)
    .eq('kind', 'mcp')
    .order('created_at', { ascending: false })

  // REST keys + webhooks + export — workspace admin only.
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
      <div className="p-4 md:p-8 space-y-6 max-w-3xl">
        <div>
          <h1 className="font-serif text-[22px] font-semibold tracking-tight text-[var(--fg-primary)]">
            API &amp; developer access
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            Programmatic access to your workspace — REST for your own integrations, MCP for AI
            clients like Claude. Plus a one-click export of everything.
          </p>
        </div>

        {/* Sovereignty — "Your data. Full stop." */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              Your data. Full stop.
            </CardTitle>
            <CardDescription>The promises behind everything on this page.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-4 sm:grid-cols-2">
              {COMMITMENTS.map((c) => (
                <li key={c.title} className="space-y-1">
                  <p className="text-sm font-medium">{c.title}</p>
                  <p className="text-sm text-muted-foreground">{c.body}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* ── REST API keys + webhooks + export (admin) ──────────────── */}
        {isAdmin ? (
          <>
            <ApiAndDataManager initialKeys={initialKeys} baseUrl={baseUrl} />
            <WebhooksManager />
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>API keys &amp; export</CardTitle>
              <CardDescription>
                Keys, webhooks, and the full data export are managed by your agency&apos;s admins.
                Ask one of them if you need access.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {/* ── MCP (every seat manages their own tokens) ──────────────── */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
              MCP — for Claude and other AI clients
            </h2>
            <p className="text-xs text-[var(--fg-secondary)]">
              Paste the endpoint and a token into your client&apos;s connector settings. Tokens
              authenticate as your agent identity — treat them like passwords.
            </p>
          </div>
          <ApiTokensManager initialTokens={(mcpTokens as McpTokenRow[]) ?? []} mcpUrl={mcpUrl} />
        </section>

        <p className="text-sm text-muted-foreground pt-2">Seize the moment — Horace</p>
      </div>
    </div>
  )
}
