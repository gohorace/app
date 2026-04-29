import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Key } from 'lucide-react'
import { ApiTokensManager } from '@/components/settings/api-tokens-manager'

export default async function ApiTokensPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: tokens } = await admin
    .from('workspace_api_tokens')
    .select('id, name, last_used_at, revoked_at, created_at')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const mcpUrl = appUrl ? `${appUrl}/api/mcp` : ''

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">API tokens</h1>
        <p className="text-muted-foreground">
          Mint a token to connect Horace to your Claude account via MCP.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="w-4 h-4" />
            Your tokens
          </CardTitle>
          <CardDescription>
            Tokens authenticate as your agent identity. Treat them like passwords —
            you can only see the token value once, at creation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ApiTokensManager initialTokens={tokens ?? []} mcpUrl={mcpUrl} />
        </CardContent>
      </Card>
    </div>
  )
}
