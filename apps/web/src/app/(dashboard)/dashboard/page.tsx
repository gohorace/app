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
    <div className="p-8 space-y-8 max-w-4xl">
      <div>
        <h1 className="font-display font-semibold tracking-tight" style={{ fontSize: '26px', color: '#1A1612' }}>
          Signals
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">What Horace picked up this week.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {stats.map(({ label, value, icon: Icon, description }) => (
          <Card key={label} className="shadow-horace-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</CardTitle>
              <Icon className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold font-mono tabular-nums" style={{ color: '#1A1612' }}>
                {value.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="shadow-horace-sm">
        <CardHeader>
          <CardTitle className="font-sans text-base font-semibold">Top contacts</CardTitle>
          <CardDescription className="text-sm">Contacts with the highest intent scores.</CardDescription>
        </CardHeader>
        <CardContent>
          {!topLeads || topLeads.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Bell className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium" style={{ color: '#1A1612' }}>Horace is watching. Nothing worth your attention yet.</p>
              <p className="text-xs mt-2 text-muted-foreground">
                <Link href="/import" className="hover:text-horace-terracotta transition-colors">
                  Import your CRM
                </Link>{' '}
                or{' '}
                <Link href="/settings/snippet" className="hover:text-horace-terracotta transition-colors">
                  install the tracking snippet
                </Link>{' '}
                to get started.
              </p>
            </div>
          ) : (
            <div>
              {topLeads.map((lead, i) => {
                const name =
                  [lead.first_name, lead.last_name].filter(Boolean).join(' ') ||
                  lead.email ||
                  'Unknown'
                return (
                  <Link
                    key={lead.id}
                    href={`/leads/${lead.id}`}
                    className="flex items-center justify-between py-3 px-2 -mx-2 rounded-md transition-colors hover:bg-accent"
                    style={{ borderBottom: i < topLeads.length - 1 ? '1px solid rgba(140,123,107,0.12)' : undefined }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="shrink-0 rounded-full flex items-center justify-center text-xs font-semibold"
                        style={{
                          width: '30px', height: '30px',
                          background: lead.score >= 50 ? 'rgba(196,98,45,0.12)' : 'rgba(140,123,107,0.1)',
                          color: lead.score >= 50 ? '#C4622D' : '#8C7B6B',
                        }}
                      >
                        {name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: '#1A1612' }}>{name}</p>
                        {lead.email && (
                          <p className="text-xs text-muted-foreground truncate">{lead.email}</p>
                        )}
                      </div>
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
  const style =
    score >= 50
      ? { background: 'rgba(196,98,45,0.1)', color: '#C4622D' }
      : score >= 20
      ? { background: 'rgba(181,146,42,0.1)', color: '#8A6A00' }
      : { background: 'rgba(140,123,107,0.1)', color: '#8C7B6B' }

  return (
    <span
      className="ml-4 shrink-0 font-mono tabular-nums text-xs font-semibold px-2 py-0.5 rounded-full"
      style={style}
    >
      {score}
    </span>
  )
}
