/**
 * /settings/email-exclusions — Server Component.
 *
 * Loads the agent's exclusion rows + hands them to the manager. Rows are
 * sorted seeded → auto_bounce → agent so the AU defaults sit at the top
 * (where the agent expects to see "what's protecting me by default").
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ShieldOff } from 'lucide-react'
import { EmailExclusionsManager } from '@/components/settings/email-exclusions-manager'

interface ExclusionRow {
  id: string
  pattern: string
  pattern_kind: 'email' | 'domain'
  reason: string | null
  source: 'agent' | 'seeded' | 'auto_bounce'
  created_at: string
}

export default async function EmailExclusionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user!.id)
    .not('workspace_id', 'is', null)
    .maybeSingle()

  let exclusions: ExclusionRow[] = []
  if (agent?.id) {
    const { data } = await admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('agent_email_exclusions' as any)
      .select('id, pattern, pattern_kind, reason, source, created_at')
      .eq('agent_id', agent.id)
      .order('source', { ascending: true })
      .order('created_at', { ascending: true })
    exclusions = ((data ?? []) as ExclusionRow[]) ?? []
  }

  // Own scroll container — dashboard <main> delegates scrolling per page (HOR-297).
  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-8 space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Email exclusions</h1>
          <p className="text-muted-foreground">
            Recipients you never want Horace to send tracked email to. Block individual
            addresses (<code className="text-[0.9em]">foo@bar.com</code>) or whole
            domains (<code className="text-[0.9em]">*@bar.com</code>).
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldOff className="w-4 h-4" />
              Your exclusion list
            </CardTitle>
            <CardDescription>
              Horace seeds an AU-default list of common portal / aggregator domains.
              You can remove a default if you genuinely send to it, but most agents
              never need to touch them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmailExclusionsManager initialExclusions={exclusions} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
