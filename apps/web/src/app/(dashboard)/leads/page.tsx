import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Search } from 'lucide-react'

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: { q?: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const agentId = agent!.id
  const q = searchParams.q?.trim() ?? ''

  let query = admin
    .from('contacts')
    .select('id, first_name, last_name, email, phone, score, identified_at, last_seen_at, crm_source')
    .eq('agent_id', agentId)
    .order('score', { ascending: false })
    .limit(200)

  if (q) {
    query = query.or(
      `email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`,
    )
  }

  const { data: leads } = await query

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
          <p className="text-muted-foreground">All contacts ranked by engagement score</p>
        </div>
        <form method="GET" className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search by name or email…"
            className="pl-9"
          />
        </form>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {q
              ? `Results for "${q}" (${leads?.length ?? 0})`
              : `All contacts (${leads?.length ?? 0})`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!leads || leads.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              {q ? (
                <>No contacts match &ldquo;{q}&rdquo;</>
              ) : (
                <>
                  No contacts yet.{' '}
                  <Link href="/import" className="underline">
                    Import your contacts
                  </Link>{' '}
                  to get started.
                </>
              )}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr className="text-left text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium hidden md:table-cell">Email</th>
                  <th className="px-6 py-3 font-medium hidden lg:table-cell">Source</th>
                  <th className="px-6 py-3 font-medium hidden lg:table-cell">Last seen</th>
                  <th className="px-6 py-3 font-medium text-right">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {leads.map((lead) => {
                  const name =
                    [lead.first_name, lead.last_name].filter(Boolean).join(' ') || '—'
                  return (
                    <tr key={lead.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-3">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="font-medium hover:underline"
                        >
                          {name}
                        </Link>
                        {lead.email && (
                          <p className="text-xs text-muted-foreground mt-0.5 md:hidden">
                            {lead.email}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-3 text-muted-foreground hidden md:table-cell">
                        {lead.email ?? '—'}
                      </td>
                      <td className="px-6 py-3 hidden lg:table-cell">
                        {lead.crm_source ? (
                          <Badge variant="outline" className="capitalize">
                            {lead.crm_source}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Web</Badge>
                        )}
                      </td>
                      <td className="px-6 py-3 text-muted-foreground hidden lg:table-cell">
                        {lead.last_seen_at
                          ? formatDistanceToNow(new Date(lead.last_seen_at), { addSuffix: true })
                          : '—'}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <ScoreChip score={lead.score} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ScoreChip({ score }: { score: number }) {
  const cls =
    score >= 50
      ? 'bg-primary text-primary-foreground'
      : score >= 20
        ? 'bg-secondary text-secondary-foreground'
        : 'bg-muted text-muted-foreground'
  return (
    <span className={`inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${cls}`}>
      {score}
    </span>
  )
}
