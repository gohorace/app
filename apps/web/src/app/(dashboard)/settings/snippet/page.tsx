import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/ui/copy-button'

export default async function SnippetPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('org_members')
    .select('org_id, orgs(slug)')
    .eq('user_id', user!.id)
    .maybeSingle()

  const orgSlug = (membership?.orgs as { slug: string } | null)?.slug ?? 'your-org-key'

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://your-domain.com'
  const cdnUrl = `${appUrl}/tracker.min.js`

  const snippetCode = `<!-- Real Estate Insights Tracker -->
<script>
  window.RIQ = {
    key: '${orgSlug}',
    apiUrl: '${appUrl}/api',
    propertyPattern: '/property/' // adjust to match your property URLs
  };
</script>
<script src="${cdnUrl}" defer></script>`

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Snippet installation</h1>
        <p className="text-muted-foreground">Add the tracking snippet to your website</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your tracking snippet</CardTitle>
          <CardDescription>
            Paste this code before the closing{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">&lt;/body&gt;</code> tag on
            every page of your website.
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
            <Badge variant="outline">Org key</Badge>
            <code className="text-xs bg-muted px-2 py-1 rounded font-mono">{orgSlug}</code>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How it works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>The snippet is <strong className="text-foreground">1.5 KB gzipped</strong> and loads asynchronously — no impact on page speed.</p>
          <ul className="space-y-1.5 list-disc list-inside">
            <li>Tracks page views, property views, scroll depth, form submissions</li>
            <li>Captures campaign links (<code className="text-xs bg-muted px-1 rounded">?_ri=token</code>) to identify known contacts</li>
            <li>Intercepts email form submissions to link anonymous visitors to contacts</li>
            <li>Fires a return visit event when a known visitor comes back</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>WordPress installation</CardTitle>
          <CardDescription>
            If your site runs on WordPress, follow these steps instead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="text-sm space-y-2 list-decimal list-inside text-muted-foreground">
            <li>Download the Real Estate Insights WordPress plugin</li>
            <li>Install and activate it from your WordPress admin panel</li>
            <li>
              Go to <strong className="text-foreground">Settings → RE Insights</strong>
            </li>
            <li>
              Paste your org key:{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">{orgSlug}</code>
            </li>
            <li>
              Set your property URL pattern (e.g.{' '}
              <code className="text-xs bg-muted px-1 rounded">/property/</code>)
            </li>
            <li>Save settings — the snippet will be injected automatically</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
