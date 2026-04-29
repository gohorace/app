import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { authorizeAction } from './actions'

interface SearchParams {
  client_id?: string
  redirect_uri?: string
  response_type?: string
  state?: string
  scope?: string
  code_challenge?: string
  code_challenge_method?: string
}

export const dynamic = 'force-dynamic'

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  // 1. Validate parameters per OAuth 2.1.
  const errors: string[] = []
  if (searchParams.response_type !== 'code') errors.push('response_type must be "code"')
  if (!searchParams.client_id) errors.push('client_id is required')
  if (!searchParams.redirect_uri) errors.push('redirect_uri is required')
  if (!searchParams.code_challenge) errors.push('code_challenge is required (PKCE is required)')
  if ((searchParams.code_challenge_method ?? 'S256') !== 'S256')
    errors.push('code_challenge_method must be S256')

  if (errors.length) {
    return (
      <ErrorPage title="Invalid authorization request">
        <ul className="list-disc list-inside text-sm">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      </ErrorPage>
    )
  }

  // 2. Look up client; verify redirect_uri.
  const admin = createAdminClient()
  const { data: client } = await admin
    .from('oauth_clients')
    .select('client_id, client_name, redirect_uris, scope')
    .eq('client_id', searchParams.client_id!)
    .maybeSingle()

  if (!client) {
    return <ErrorPage title="Unknown client"><p className="text-sm">This client_id is not registered.</p></ErrorPage>
  }
  if (!client.redirect_uris.includes(searchParams.redirect_uri!)) {
    return (
      <ErrorPage title="Redirect URI mismatch">
        <p className="text-sm">
          The redirect_uri does not match any URI registered for this client.
        </p>
      </ErrorPage>
    )
  }

  // 3. Require a Supabase session. Bounce through /login if missing,
  // preserving the full authorize URL as the post-login destination.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const here = '/oauth/authorize?' + new URLSearchParams(
      Object.entries(searchParams).filter(([, v]) => v != null) as [string, string][],
    ).toString()
    redirect(`/login?redirectTo=${encodeURIComponent(here)}`)
  }

  // 4. Look up the user's agent + workspace for the consent context.
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id, first_name, last_name, email')
    .eq('user_id', user!.id)
    .not('workspace_id', 'is', null)
    .maybeSingle()
  if (!agent || !agent.workspace_id) {
    return (
      <ErrorPage title="No workspace">
        <p className="text-sm">
          You need to finish workspace signup before connecting an external client.
        </p>
      </ErrorPage>
    )
  }
  const { data: workspace } = await admin
    .from('workspaces')
    .select('name')
    .eq('id', agent.workspace_id)
    .maybeSingle()

  const agentName =
    [agent.first_name, agent.last_name].filter(Boolean).join(' ') || agent.email || 'Your agent'

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Authorize {client.client_name ?? 'an external app'}</CardTitle>
          <CardDescription>
            This app is requesting access to your Horace workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Workspace</span>
              <span className="font-medium">{workspace?.name ?? 'My workspace'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Agent</span>
              <span className="font-medium">{agentName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Scope</span>
              <Badge variant="outline">{searchParams.scope || client.scope}</Badge>
            </div>
          </div>

          <div className="border rounded-md p-3 text-xs space-y-1.5 bg-muted/40">
            <p className="font-medium text-foreground">By authorizing, you allow this app to:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
              <li>Read your contacts, scores, and website activity</li>
              <li>Create campaigns and decorate / shorten links on your behalf</li>
              <li>Send SMS via your Twilio number to contacts in this workspace</li>
              <li>Record outreach and notes</li>
            </ul>
            <p className="text-muted-foreground pt-1">
              You can revoke access any time from Settings → API tokens.
            </p>
          </div>

          <form action={authorizeAction} className="flex gap-2">
            <input type="hidden" name="client_id" value={searchParams.client_id} />
            <input type="hidden" name="redirect_uri" value={searchParams.redirect_uri} />
            <input type="hidden" name="state" value={searchParams.state ?? ''} />
            <input type="hidden" name="scope" value={searchParams.scope ?? client.scope} />
            <input type="hidden" name="code_challenge" value={searchParams.code_challenge} />
            <input
              type="hidden"
              name="code_challenge_method"
              value={searchParams.code_challenge_method ?? 'S256'}
            />
            <button
              type="submit"
              name="decision"
              value="deny"
              className="flex-1 inline-flex items-center justify-center rounded-md border bg-background h-9 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              name="decision"
              value="approve"
              className="flex-1 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground h-9 text-sm font-medium hover:bg-primary/90"
            >
              Authorize
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function ErrorPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  )
}
