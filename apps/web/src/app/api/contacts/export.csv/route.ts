/**
 * HOR-138 — GET /api/contacts/export.csv
 *
 * Exports the agent's contact book as a CSV with each contact's tracked
 * link as a column. Used by the Digest empty state's "Send a tracked
 * newsletter" activity prompt: the agent downloads the CSV, drops it into
 * their newsletter tool of choice (Mailchimp / Klaviyo / Gmail mail-merge),
 * and uses the tracked-URL column as a mail-merge field. Each recipient
 * gets their own tracked link → Horace knows exactly who clicked through.
 *
 * Columns:
 *   id, first_name, last_name, email, phone, suburb, tracked_url
 *
 * Anonymous contacts (no token yet) are excluded — their tracked_url
 * would be empty and they probably don't have an email to send to anyway.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

export const dynamic = 'force-dynamic'

function csvEscape(value: string | null | undefined): string {
  if (value == null) return ''
  // Always quote — safer than trying to detect whether quoting is needed.
  // Double any embedded quotes per RFC 4180.
  return `"${value.replace(/"/g, '""')}"`
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const agent = await resolvePrimaryAgent(admin, user.id)
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.gohorace.com').replace(/\/$/, '')

  // Pull every contact's tracked-link fields via the existing RPC. The RPC
  // already filters soft-deleted rows.
  const { data: contacts, error } = await admin
    .rpc('get_contacts_list', { p_agent_id: agent.id })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Build CSV. Header line first, then one line per contact with a
  // tracked token. Anonymous / token-less contacts are skipped (their
  // tracked_url column would be empty).
  const rows = (contacts ?? []).filter((c) => c.tracked_link_token != null)

  const header = [
    'id',
    'first_name',
    'last_name',
    'email',
    'phone',
    'suburb',
    'tracked_url',
  ].join(',')

  const lines = rows.map((c) => [
    csvEscape(c.id),
    csvEscape(c.first_name),
    csvEscape(c.last_name),
    csvEscape(c.email),
    csvEscape(c.phone),
    csvEscape(c.suburb),
    csvEscape(`${appUrl}/c/${c.tracked_link_token}`),
  ].join(','))

  const body = [header, ...lines].join('\n') + '\n'

  // Use a date-stamped filename so repeated exports don't collide in the
  // agent's downloads folder.
  const today = new Date().toISOString().slice(0, 10)
  const filename = `horace-contacts-${today}.csv`

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Don't cache — contacts and tracked-link tokens can change.
      'Cache-Control': 'no-store',
    },
  })
}
