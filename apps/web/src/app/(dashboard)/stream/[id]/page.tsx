import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MomentCard } from '@/components/notifications/moment-card'
import { deriveMomentType } from '@/lib/notifications/derive-moment-type'
import { toStreamMoment, type RawContactRow, type RawNotificationRow } from '@/lib/notifications/to-stream-moment'

export const dynamic = 'force-dynamic'

/**
 * HOR-350 · Stream permalink. Renders a single moment by notification_log id,
 * workspace-scoped. Backs the property detail's "Surfaced in your Stream" link
 * (the Stream itself is otherwise a feed-only slide-over). 404s on a missing
 * row or one that isn't a renderable stream moment.
 */
export default async function StreamMomentPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user!.id)
    .maybeSingle()

  if (!agent?.workspace_id) notFound()

  // Workspace-scoped read — an agent can only open their own workspace's moments.
  const { data: row } = await admin
    .from('notification_log')
    .select('id, type, contact_id, title, body, url, sent_at, read_at')
    .eq('id', params.id)
    .eq('workspace_id', agent.workspace_id)
    .maybeSingle()

  if (!row) notFound()

  const notif = row as unknown as RawNotificationRow

  // Hydrate the subject contact (stream moments are contact-subject today).
  let contact: RawContactRow | null = null
  if (notif.contact_id) {
    const { data: c } = await admin
      .from('contacts')
      .select('id, first_name, last_name, suburb, last_seen_at, identified_at')
      .eq('id', notif.contact_id)
      .is('deleted_at', null)
      .maybeSingle()
    contact = (c as RawContactRow | null) ?? null
  }

  const momentType = deriveMomentType(notif, contact ?? undefined)
  if (!momentType) notFound() // audit/channel row — not a renderable moment

  // Agent timezone for the time-ago stamp (best-effort, matches the stream API).
  const { data: settings } = await admin
    .from('agent_settings')
    .select('timezone')
    .eq('agent_id', agent.id)
    .maybeSingle()

  const moment = toStreamMoment({
    row: notif,
    contact,
    momentType,
    now: new Date(),
    tz: settings?.timezone ?? null,
  })

  return (
    <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 80 }}>
      <div style={{ maxWidth: 640, padding: '20px 32px' }}>
        {/* Breadcrumb — the Stream lives on the activity surface (/digest). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, fontSize: 13 }}>
          <Link
            href="/digest"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: '#8C7B6B',
              textDecoration: 'none',
              fontWeight: 500,
              padding: '4px 6px',
              borderRadius: 4,
            }}
          >
            <ArrowLeft style={{ width: 14, height: 14 }} />
            Stream
          </Link>
          <span style={{ color: 'rgba(140,123,107,0.4)' }}>/</span>
          <span style={{ color: '#1A1612', fontWeight: 500 }}>This moment</span>
        </div>

        <MomentCard moment={moment} />
      </div>
    </div>
  )
}
