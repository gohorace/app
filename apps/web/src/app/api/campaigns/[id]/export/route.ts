import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function appendToken(url: string, token: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}_ri=${token}`
}

function escapeCsv(value: string | null | undefined): string {
  const s = value ?? ''
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'No agent found' }, { status: 400 })
  const agentId = agent.id

  // Get campaign (verify ownership)
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, name, description')
    .eq('id', params.id)
    .eq('agent_id', agentId)
    .maybeSingle()

  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const targetUrl = campaign.description ?? ''

  // Get tokens with contact info
  const { data: tokens, error } = await admin
    .from('campaign_tokens')
    .select('token, contacts(first_name, last_name, email, phone)')
    .eq('campaign_id', params.id)
    .eq('agent_id', agentId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = [['First Name', 'Last Name', 'Email', 'Phone', 'Tracked URL']]

  for (const t of tokens ?? []) {
    const contact = Array.isArray(t.contacts) ? t.contacts[0] : t.contacts
    rows.push([
      escapeCsv(contact?.first_name),
      escapeCsv(contact?.last_name),
      escapeCsv(contact?.email),
      escapeCsv(contact?.phone),
      escapeCsv(targetUrl ? appendToken(targetUrl, t.token) : t.token),
    ])
  }

  const csv = rows.map((r) => r.join(',')).join('\r\n')
  const safeName = campaign.name.replace(/[^a-z0-9-_ ]/gi, '').trim()

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="campaign-${safeName}.csv"`,
    },
  })
}
