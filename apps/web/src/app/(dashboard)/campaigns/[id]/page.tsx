import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/ui/copy-button'
import { Download, ExternalLink, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow, format } from 'date-fns'
import { notFound } from 'next/navigation'

function appendToken(url: string, token: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}_ri=${token}`
}

function truncateUrl(url: string, max = 48): string {
  return url.length > max ? url.slice(0, max) + '…' : url
}

export default async function CampaignDetailPage({
  params,
}: {
  params: { id: string }
}) {
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

  if (!agent) notFound()
  const agentId = agent.id

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, name, description, created_at')
    .eq('id', params.id)
    .eq('agent_id', agentId)
    .maybeSingle()

  if (!campaign) notFound()

  const { data: tokens } = await admin
    .from('campaign_tokens')
    .select('id, token, clicked_at, created_at, contacts(id, first_name, last_name, email, phone)')
    .eq('campaign_id', params.id)
    .eq('agent_id', agentId)
    .order('created_at', { ascending: true })

  const targetUrl = campaign.description ?? ''
  const tokenRows = tokens ?? []
  const totalCount = tokenRows.length
  const clickedCount = tokenRows.filter((t) => t.clicked_at !== null).length
  const clickRate = totalCount > 0 ? Math.round((clickedCount / totalCount) * 100) : 0

  return (
    <div className="p-8 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Link href="/campaigns" className="hover:underline flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" />
              Campaigns
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
          {targetUrl && (
            <a
              href={targetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              {truncateUrl(targetUrl)}
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            </a>
          )}
          <p className="text-xs text-muted-foreground">
            Created {formatDistanceToNow(new Date(campaign.created_at), { addSuffix: true })}
          </p>
        </div>
        {totalCount > 0 && (
          <Button asChild variant="outline">
            <a href={`/api/campaigns/${campaign.id}/export`} download>
              <Download className="w-4 h-4 mr-2" />
              Download CSV
            </a>
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Contacts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Clicked</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{clickedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Click rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${clickRate >= 20 ? 'text-green-600' : ''}`}>
              {totalCount > 0 ? `${clickRate}%` : '—'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Contacts table */}
      <Card>
        <CardContent className="p-0">
          {tokenRows.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No contacts in this campaign yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr className="text-left text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium hidden md:table-cell">Email</th>
                  <th className="px-6 py-3 font-medium hidden lg:table-cell">Phone</th>
                  <th className="px-6 py-3 font-medium">Tracked URL</th>
                  <th className="px-6 py-3 font-medium">Clicked</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tokenRows.map((row) => {
                  const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts
                  const fullName =
                    [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || '—'
                  const trackedUrl = targetUrl ? appendToken(targetUrl, row.token) : ''
                  const isClicked = row.clicked_at !== null

                  return (
                    <tr
                      key={row.id}
                      className={`transition-colors ${
                        isClicked ? 'bg-green-50/60 hover:bg-green-50' : 'hover:bg-muted/50'
                      }`}
                    >
                      <td className="px-6 py-3">
                        <Link
                          href={`/leads/${contact?.id}`}
                          className="font-medium hover:underline"
                        >
                          {fullName}
                        </Link>
                      </td>
                      <td className="px-6 py-3 text-muted-foreground hidden md:table-cell">
                        {contact?.email ?? '—'}
                      </td>
                      <td className="px-6 py-3 text-muted-foreground hidden lg:table-cell">
                        {contact?.phone ?? '—'}
                      </td>
                      <td className="px-6 py-3">
                        {trackedUrl ? (
                          <div className="flex items-center gap-1 max-w-xs">
                            <span className="text-xs text-muted-foreground truncate font-mono">
                              {truncateUrl(trackedUrl, 40)}
                            </span>
                            <CopyButton text={trackedUrl} />
                          </div>
                        ) : (
                          <span className="text-muted-foreground font-mono text-xs">{row.token}</span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        {isClicked ? (
                          <Badge variant="default" className="text-xs">
                            {format(new Date(row.clicked_at!), 'dd MMM yyyy')}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">Not yet</span>
                        )}
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
