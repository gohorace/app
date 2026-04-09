import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Megaphone, Plus } from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'

export default async function CampaignsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const agentId = agent!.id

  const { data: campaigns } = await admin
    .from('campaigns')
    .select('id, name, description, created_at, campaign_tokens(id, clicked_at)')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })

  const rows = (campaigns ?? []).map((c) => {
    const tokens = c.campaign_tokens ?? []
    const tokenCount = tokens.length
    const clickedCount = tokens.filter((t) => t.clicked_at !== null).length
    const clickRate = tokenCount > 0 ? Math.round((clickedCount / tokenCount) * 100) : 0
    return { ...c, tokenCount, clickedCount, clickRate }
  })

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
          <p className="text-muted-foreground">Generate tracked links for email and SMS campaigns</p>
        </div>
        <Button asChild>
          <Link href="/campaigns/new">
            <Plus className="w-4 h-4 mr-2" />
            New campaign
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No campaigns yet</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="py-8 text-center">
              <Megaphone className="w-10 h-10 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-sm text-muted-foreground mb-4">
                Create a campaign to generate unique tracked links for each contact. When contacts
                click these links, they&apos;re immediately identified on your website.
              </p>
              <Button asChild>
                <Link href="/campaigns/new">
                  <Plus className="w-4 h-4 mr-2" />
                  Create your first campaign
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr className="text-left text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Campaign</th>
                  <th className="px-6 py-3 font-medium hidden md:table-cell">Contacts</th>
                  <th className="px-6 py-3 font-medium hidden md:table-cell">Clicked</th>
                  <th className="px-6 py-3 font-medium hidden lg:table-cell">Click rate</th>
                  <th className="px-6 py-3 font-medium hidden lg:table-cell">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-6 py-3">
                      <Link
                        href={`/campaigns/${row.id}`}
                        className="font-medium hover:underline"
                      >
                        {row.name}
                      </Link>
                      {row.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">
                          {row.description}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground hidden md:table-cell">
                      {row.tokenCount}
                    </td>
                    <td className="px-6 py-3 hidden md:table-cell">
                      {row.clickedCount > 0 ? (
                        <Badge variant="default">{row.clickedCount}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-6 py-3 hidden lg:table-cell">
                      {row.tokenCount > 0 ? (
                        <span className={row.clickRate >= 20 ? 'text-green-600 font-medium' : ''}>
                          {row.clickRate}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground hidden lg:table-cell">
                      {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
