import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { formatDistanceToNow, format } from 'date-fns'
import {
  ArrowLeft,
  Mail,
  Phone,
  TrendingUp,
  Eye,
  MousePointerClick,
  FileText,
  ArrowDownToLine,
  Repeat,
} from 'lucide-react'

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const agentId = agent!.id

  const [{ data: contact }, { data: contactEvents }, { data: scoreHistory }] = await Promise.all([
    admin
      .from('contacts')
      .select('*')
      .eq('id', params.id)
      .eq('agent_id', agentId)
      .maybeSingle(),
    admin.rpc('get_contact_events', { p_contact_id: params.id }),
    admin
      .from('score_history')
      .select('id, delta, reason, score_before, score_after, occurred_at')
      .eq('contact_id', params.id)
      .eq('agent_id', agentId)
      .order('occurred_at', { ascending: false })
      .limit(10),
  ])

  // Normalise RPC result to the shape the timeline expects
  const events = (contactEvents ?? []).map((e) => ({
    id: e.event_id,
    event_type: e.event_type,
    properties: e.properties,
    score_delta: e.score_delta,
    occurred_at: e.occurred_at,
  }))

  if (!contact) notFound()

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unknown'

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link
          href="/leads"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
        {contact.crm_source && (
          <Badge variant="outline" className="capitalize">
            {contact.crm_source}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Contact info */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Contact details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {contact.email && (
              <div className="flex items-center gap-3 text-sm">
                <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                <a href={`mailto:${contact.email}`} className="hover:underline">
                  {contact.email}
                </a>
              </div>
            )}
            {contact.phone && (
              <div className="flex items-center gap-3 text-sm">
                <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                <a href={`tel:${contact.phone}`} className="hover:underline">
                  {contact.phone}
                </a>
              </div>
            )}
            <div className="pt-2 grid grid-cols-2 gap-4 text-sm text-muted-foreground border-t">
              <div>
                <p className="font-medium text-foreground">Identified</p>
                <p>
                  {contact.identified_at
                    ? format(new Date(contact.identified_at), 'd MMM yyyy')
                    : 'Not yet'}
                </p>
              </div>
              <div>
                <p className="font-medium text-foreground">Last seen</p>
                <p>
                  {contact.last_seen_at
                    ? formatDistanceToNow(new Date(contact.last_seen_at), { addSuffix: true })
                    : 'Never'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Score */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Engagement score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-5xl font-bold tabular-nums">{contact.score}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {contact.score >= 50
                ? 'Hot lead'
                : contact.score >= 20
                  ? 'Warm lead'
                  : 'Cold lead'}
            </p>
            {scoreHistory && scoreHistory.length > 0 && (
              <div className="mt-4 space-y-1.5">
                {scoreHistory.slice(0, 5).map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground truncate">{s.reason}</span>
                    <span className={s.delta > 0 ? 'text-green-700 font-medium' : 'text-muted-foreground'}>
                      {s.delta > 0 ? `+${s.delta}` : s.delta}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Event timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {!events || events.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No website activity recorded yet.
            </p>
          ) : (
            <div className="relative space-y-0">
              {events.map((event, i) => (
                <div key={event.id} className="flex gap-4 pb-4">
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <EventIcon type={event.event_type} />
                    </div>
                    {i < events.length - 1 && (
                      <div className="w-px flex-1 bg-border mt-1" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 pt-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium capitalize">
                        {event.event_type.replace(/_/g, ' ')}
                      </p>
                      <div className="flex items-center gap-2 shrink-0">
                        {event.score_delta > 0 && (
                          <span className="text-xs text-green-700 font-medium">
                            +{event.score_delta}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(event.occurred_at), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                    <EventMeta event={event} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function EventIcon({ type }: { type: string }) {
  const cls = 'w-4 h-4 text-muted-foreground'
  switch (type) {
    case 'page_view':      return <Eye className={cls} />
    case 'property_view':  return <Eye className={cls} />
    case 'form_submit':    return <FileText className={cls} />
    case 'campaign_click': return <MousePointerClick className={cls} />
    case 'scroll_depth':   return <ArrowDownToLine className={cls} />
    case 'return_visit':   return <Repeat className={cls} />
    default:               return <Eye className={cls} />
  }
}

function EventMeta({ event }: { event: { event_type: string; properties: unknown } }) {
  const p = (event.properties ?? {}) as Record<string, unknown>
  const parts: string[] = []

  if (p.url && typeof p.url === 'string') {
    try {
      parts.push(new URL(p.url).pathname)
    } catch {
      parts.push(p.url)
    }
  }
  if (p.title && typeof p.title === 'string') parts.push(p.title)
  if (p.pct && typeof p.pct === 'number') parts.push(`${p.pct}% scrolled`)

  if (parts.length === 0) return null
  return <p className="text-xs text-muted-foreground mt-0.5 truncate">{parts.join(' · ')}</p>
}
