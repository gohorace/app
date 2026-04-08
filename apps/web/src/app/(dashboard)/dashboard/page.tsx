import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Users, TrendingUp, Eye, Bell } from 'lucide-react'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Get agent record for this user (includes workspace_id)
  const { data: agent } = await supabase
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const agentId = agent?.id
  const workspaceId = agent?.workspace_id

  // Fetch summary stats
  const [
    { count: totalContacts },
    { count: identifiedContacts },
    { count: recentEvents },
    { data: topLeads },
  ] = await Promise.all([
    supabase
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', agentId!),
    supabase
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', agentId!)
      .not('identified_at', 'is', null),
    supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId!)
      .gte('occurred_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    supabase
      .from('contacts')
      .select('id, first_name, last_name, email, score, last_seen_at')
      .eq('agent_id', agentId!)
      .order('score', { ascending: false })
      .limit(5),
  ])

  const stats = [
    {
      label: 'Total contacts',
      value: totalContacts ?? 0,
      icon: Users,
      description: 'In your CRM',
    },
    {
      label: 'Identified leads',
      value: identifiedContacts ?? 0,
      icon: TrendingUp,
      description: 'Website visitors linked to contacts',
    },
    {
      label: 'Events today',
      value: recentEvents ?? 0,
      icon: Eye,
      description: 'Website interactions in last 24h',
    },
  ]

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Your lead activity at a glance</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {stats.map(({ label, value, icon: Icon, description }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <Icon className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{value.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">{description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top leads</CardTitle>
          <CardDescription>Contacts with the highest engagement scores</CardDescription>
        </CardHeader>
        <CardContent>
          {!topLeads || topLeads.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bell className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No leads yet.</p>
              <p className="text-xs mt-1">
                <Link href="/import" className="underline">
                  Import your CRM
                </Link>{' '}
                or{' '}
                <Link href="/settings/snippet" className="underline">
                  install the tracking snippet
                </Link>{' '}
                to get started.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {topLeads.map((lead) => {
                const name =
                  [lead.first_name, lead.last_name].filter(Boolean).join(' ') ||
                  lead.email ||
                  'Unknown'
                return (
                  <Link
                    key={lead.id}
                    href={`/leads/${lead.id}`}
                    className="flex items-center justify-between py-3 hover:bg-muted/50 px-2 -mx-2 rounded-md transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{name}</p>
                      {lead.email && (
                        <p className="text-xs text-muted-foreground truncate">{lead.email}</p>
                      )}
                    </div>
                    <ScoreBadge score={lead.score} />
                  </Link>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const variant =
    score >= 50 ? 'default' : score >= 20 ? 'secondary' : 'outline'
  return (
    <Badge variant={variant} className="ml-4 shrink-0 font-mono tabular-nums">
      {score}
    </Badge>
  )
}
