import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { Check } from 'lucide-react'
import { getAppUrl } from '@/lib/url'
import { trackingSnippet } from '@/lib/onboarding/snippet'
import { SectionHeading } from '@/components/ui/section-heading'
import { CardLabel } from '@/components/ui/card-label'
import { Badge } from '@/components/ui/badge'
import { CodeBlock } from '@/components/ui/code-block'
import { InstallHelp } from './install-help'

export default async function SnippetPage() {
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

  const { data: workspace } = agent?.workspace_id
    ? await admin
        .from('workspaces')
        .select('snippet_key')
        .eq('id', agent.workspace_id)
        .maybeSingle()
    : { data: null }

  const snippetKey = workspace?.snippet_key ?? 'your-snippet-key'
  const appUrl = getAppUrl() || 'https://your-domain.com'

  const snippetCode = trackingSnippet(snippetKey, appUrl)

  const points = [
    'Tracks page views, property views, scroll depth and form submissions.',
    'Intercepts email form submissions to link anonymous visitors to contacts.',
    'Fires a return-visit event when a known visitor comes back.',
  ]

  // Own scroll container — dashboard <main> delegates scrolling per page (HOR-297).
  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-4 md:p-8">
        <div className="max-w-[660px] space-y-4">
          <SectionHeading
            title="Install snippet"
            description="The tracking code that lets Horace read your website's signals."
          />

          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[22px] shadow-[var(--shadow-sm)]">
            <div className="mb-3 flex items-center justify-between">
              <CardLabel className="mb-0">Your tracking snippet</CardLabel>
              <Badge variant="stone">Snippet key {snippetKey}</Badge>
            </div>
            <CodeBlock code={snippetCode} />
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--fg-secondary)]">
              <span>Paste before the closing</span>
              <code className="rounded bg-[rgba(140,123,107,0.12)] px-1.5 py-0.5 font-mono">
                &lt;/head&gt;
              </code>
              <span>tag on every page.</span>
            </div>
          </div>

          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[22px] shadow-[var(--shadow-sm)]">
            <CardLabel>How it works</CardLabel>
            <p className="mb-2.5 text-sm text-[var(--fg-primary)]">
              The snippet is <strong>1.5 KB gzipped</strong> and loads asynchronously — no impact on
              page speed.
            </p>
            <ul className="flex flex-col gap-2">
              {points.map((t) => (
                <li
                  key={t}
                  className="flex gap-2 text-xs leading-relaxed text-[var(--fg-secondary)]"
                >
                  <Check className="mt-0.5 size-3.5 shrink-0 text-[var(--color-moss)]" />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <InstallHelp snippet={snippetCode} snippetKey={snippetKey} appUrl={appUrl} />
        </div>
      </div>
    </div>
  )
}
