import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/ui/copy-button'
import { EmbedOriginsManager } from '@/components/settings/embed-origins-manager'

/**
 * HOR-285 — Website embed generator + allowed-origins config.
 *
 * Gives the agent their paste-in snippet and lets them register the site
 * origin(s) the embed may submit from. The embed (HOR-283) renders into the
 * `<div data-doorstep-embed>` wherever the agent places it; submissions hit
 * /api/embed/capture (HOR-284), which hard-rejects origins not listed here.
 */
export default async function EmbedPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const workspaceId = agent?.workspace_id ?? null

  const { data: workspace } = workspaceId
    ? await admin.from('workspaces').select('snippet_key').eq('id', workspaceId).maybeSingle()
    : { data: null }
  const { data: settings } = workspaceId
    ? await admin
        .from('workspace_settings')
        .select('snippet_domains')
        .eq('workspace_id', workspaceId)
        .maybeSingle()
    : { data: null }
  const { data: domainRows } = workspaceId
    ? await admin
        // workspace_custom_domains (HOR-204) may lag database.types.ts — cast.
        .from('workspace_custom_domains' as never)
        .select('hostname')
        .eq('workspace_id', workspaceId)
        .eq('status', 'verified')
    : { data: null }

  const snippetKey = workspace?.snippet_key ?? 'your-snippet-key'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.gohorace.com'
  const embedUrl = `${appUrl}/embed.min.js`

  const snippetCode = `<!-- Doorstep -->
<div data-doorstep-embed></div>
<script src="${embedUrl}" data-key="${snippetKey}" defer></script>`

  const initialOrigins = (settings?.snippet_domains as string[] | undefined) ?? []
  const autoAllowed = (((domainRows as { hostname: string }[] | null) ?? []).map((d) => d.hostname))

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Website embed</h1>
        <p className="text-muted-foreground">
          A sign-in form for your own website. It captures a name and mobile, then watches what that
          visitor does next.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your embed code</CardTitle>
          <CardDescription>
            Paste this where you want the form to appear — an appraisal page, a contact page, a
            listing. The form shows up wherever you put the{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">&lt;div&gt;</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <pre className="bg-muted rounded-lg p-4 text-xs overflow-x-auto whitespace-pre-wrap break-all pr-12">
              <code>{snippetCode}</code>
            </pre>
            <div className="absolute top-2 right-2">
              <CopyButton text={snippetCode} />
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">Embed key</Badge>
            <code className="text-xs bg-muted px-2 py-1 rounded font-mono">{snippetKey}</code>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allowed sites</CardTitle>
          <CardDescription>
            For security, the form only accepts sign-ins from sites you list here. Add the website
            you’re pasting the embed on.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmbedOriginsManager initialOrigins={initialOrigins} autoAllowed={autoAllowed} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How to install</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3">
          <ul className="space-y-1.5 list-disc list-inside">
            <li>
              <strong className="text-foreground">WordPress:</strong> add a “Custom HTML” block
              where you want the form and paste the code in.
            </li>
            <li>
              <strong className="text-foreground">Squarespace / Wix:</strong> add an “Embed” or
              “Custom code / HTML” element and paste the code in.
            </li>
            <li>
              <strong className="text-foreground">Hand-coded site:</strong> paste the code straight
              into your page’s HTML.
            </li>
          </ul>
          <p>
            It loads asynchronously and inherits your site’s styling — to a visitor it looks like
            your own form. Don’t forget to add your site under{' '}
            <strong className="text-foreground">Allowed sites</strong> above, or sign-ins won’t go
            through.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
