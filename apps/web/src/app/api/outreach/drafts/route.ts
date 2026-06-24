/**
 * POST /api/outreach/drafts — HOR-388 (P4)
 *
 * The nudge's three drafts (email / SMS / call notes), grounded in the agent's
 * own matched site content. Pipeline:
 *   match (P3) → just-in-time verify the chosen URLs (P2) → pretext
 *   (signal-draft) → generate + firewall (draft-outreach) → return.
 *
 * Pre-generation is cached in getOutreachDrafts; the JIT verify here is the
 * final freshness gate on the ≤5 URLs actually about to be referenced, so a
 * listing sold since the last crawl drops out before it reaches the draft.
 *
 * Auth mirrors /api/email/draft (MCP bearer → cookie session).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authenticateRequest } from '@/lib/mcp/auth'
import { loadProfile } from '@/lib/mcp/profile'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'
import { derivePretext, fetchRecentSoldBySuburb } from '@/lib/ai/signal-draft'
import { matchContentForContact } from '@/lib/outreach/match-content'
import { verifyUrlsForDraft, type FreshnessRow } from '@/lib/outreach/freshness'
import { getOutreachDrafts } from '@/lib/outreach/draft-outreach'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Auth {
  agentId: string
  agentName: string
}

export async function POST(req: NextRequest) {
  let auth: Auth
  try {
    auth = await resolveAuth(req)
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { contact_id?: string }
  try {
    body = (await req.json()) as { contact_id?: string }
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 })
  }
  const contactId = body.contact_id?.trim()
  if (!contactId) return NextResponse.json({ error: 'contact_id is required' }, { status: 400 })

  const admin = createAdminClient()

  const { data: contact } = await admin
    .from('contacts')
    .select('id, first_name, last_name, email, suburb, agent_id')
    .eq('id', contactId)
    .maybeSingle()
  if (!contact || contact.agent_id !== auth.agentId) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }

  // 1. Match the lead's behaviour to fresh content.
  const match = await matchContentForContact(admin, { agentId: auth.agentId, contactId: contact.id })

  // 2. Just-in-time verify the chosen URLs; drop any slot whose pick went dead.
  if (match.slots.length > 0) {
    const rows: FreshnessRow[] = match.slots.map((s) => ({
      id: s.chosen.id,
      content_type: s.chosen.content_type,
      source_url: s.chosen.source_url,
      last_http_status: 200,
      last_crawled_at: s.chosen.last_crawled_at,
      last_verified_at: null,
      sold_date: s.chosen.sold_date,
      still_active: true,
    }))
    const liveIds = new Set((await verifyUrlsForDraft(admin, rows)).map((r) => r.id))
    match.slots = match.slots.filter((s) => liveIds.has(s.chosen.id))
  }

  // 3. Pretext (truthful hook) + the agent's voice.
  const soldBySuburb = await fetchRecentSoldBySuburb(admin, auth.agentId, [contact.suburb])
  const pretext = await derivePretext(admin, auth.agentId, { id: contact.id, suburb: contact.suburb }, soldBySuburb)
  const profile = await loadProfile(admin, auth.agentId)
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email || 'there'

  // 4. Generate (cached) + firewall.
  const drafts = await getOutreachDrafts({
    agentId: auth.agentId,
    contactId: contact.id,
    agentName: auth.agentName,
    contact: { name, first_name: contact.first_name },
    pretext,
    match,
    voice: profile.complete ? { brand_voice: profile.brand_voice, email_signature: profile.email_signature } : undefined,
  })

  return NextResponse.json(
    {
      rule: drafts.match.rule,
      suburb: drafts.match.suburb,
      email: drafts.email,
      sms: drafts.sms,
      call_notes: drafts.callNotes,
      slots: drafts.match.slots,
      pretext_label: pretext.label,
    },
    { status: 200 },
  )
}

async function resolveAuth(req: NextRequest): Promise<Auth> {
  const mcp = await authenticateRequest(req)
  if (mcp) {
    const admin = createAdminClient()
    const { data: agent } = await admin.from('agents').select('first_name, last_name').eq('id', mcp.agentId).maybeSingle()
    return { agentId: mcp.agentId, agentName: fullName(agent) }
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const resolved = await resolvePrimaryAgent(admin, user.id, { requireWorkspace: true })
  if (!resolved) throw NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  const { data: agent } = await admin.from('agents').select('first_name, last_name').eq('id', resolved.id).maybeSingle()
  return { agentId: resolved.id, agentName: fullName(agent) }
}

function fullName(agent: { first_name?: string | null; last_name?: string | null } | null): string {
  if (!agent) return 'there'
  return [agent.first_name, agent.last_name].filter(Boolean).join(' ') || 'there'
}
