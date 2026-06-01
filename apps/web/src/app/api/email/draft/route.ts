/**
 * POST /api/email/draft
 *
 * On-demand Horace draft for the tracked-email composer dock (HOR-356).
 *
 * The Digest generates drafts server-side at render; the dock's "Ask Horace
 * to draft" needs the same engine on demand, so this route reuses the Digest
 * firewall + pretext pipeline (`lib/ai/signal-draft.ts`) verbatim — same
 * voice, same banned-phrase guard. The only net-new logic is the profile
 * gate: if the agent hasn't set a brand voice + signature we return
 * `setup_required` so the dock can show its setup state instead of drafting.
 *
 * Auth mirrors /api/email/send (MCP bearer → cookie session).
 *
 * NOTE: signal-draft uses a generic Horace voice and signs with the agent's
 * first name — it does NOT consume agent_settings.brand_voice /
 * email_signature today. The profile gate here is a product guard, not an
 * input to generation. Folding brand voice into the draft is a follow-up
 * (see HOR-354 epic flag).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authenticateRequest } from '@/lib/mcp/auth'
import { loadProfile } from '@/lib/mcp/profile'
import {
  derivePretext,
  fetchRecentSoldBySuburb,
  getCachedSignalDraft,
} from '@/lib/ai/signal-draft'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface DraftAuth {
  agentId: string
  agentName: string
}

interface DraftRequest {
  contact_id?: string
}

export async function POST(req: NextRequest) {
  let auth: DraftAuth
  try {
    auth = await resolveAuth(req)
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: DraftRequest
  try {
    body = (await req.json()) as DraftRequest
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 })
  }
  const contactId = body.contact_id?.trim()
  if (!contactId) {
    return NextResponse.json({ error: 'contact_id is required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // ── Profile gate — drives the dock's `setup` state ──────────────────────
  const profile = await loadProfile(admin, auth.agentId)
  if (!profile.complete) {
    return NextResponse.json(
      { setup_required: true, missing: profile.missing_required },
      { status: 200 },
    )
  }

  // ── Load the contact (scoped to the agent) ───────────────────────────────
  const { data: contact } = await admin
    .from('contacts')
    .select('id, first_name, last_name, email, suburb, agent_id')
    .eq('id', contactId)
    .maybeSingle()

  if (!contact || contact.agent_id !== auth.agentId) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }

  // ── Pretext + draft (Digest pipeline, reused verbatim) ───────────────────
  const soldBySuburb = await fetchRecentSoldBySuburb(admin, auth.agentId, [contact.suburb])
  const pretext = await derivePretext(
    admin,
    auth.agentId,
    { id: contact.id, suburb: contact.suburb },
    soldBySuburb,
  )

  const draft = await getCachedSignalDraft({
    agentId: auth.agentId,
    agentName: auth.agentName,
    contact: {
      contact_id: contact.id,
      first_name: contact.first_name,
      last_name: contact.last_name,
      email: contact.email,
    },
    pretext,
  })

  if (!draft) {
    // API key unset, model error, or the firewall held — the dock shows
    // `failed-draft` ("Horace couldn't draft this one").
    return NextResponse.json({ error: 'draft_unavailable' }, { status: 502 })
  }

  return NextResponse.json(
    { subject: draft.subject, body: draft.body, pretext_label: pretext.label },
    { status: 200 },
  )
}

// ── Auth ──────────────────────────────────────────────────────────────────

async function resolveAuth(req: NextRequest): Promise<DraftAuth> {
  const mcp = await authenticateRequest(req)
  if (mcp) {
    const admin = createAdminClient()
    const { data: agent } = await admin
      .from('agents')
      .select('first_name, last_name')
      .eq('id', mcp.agentId)
      .maybeSingle()
    return { agentId: mcp.agentId, agentName: fullName(agent) }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, first_name, last_name, workspace_id')
    .eq('user_id', user.id)
    .not('workspace_id', 'is', null)
    .maybeSingle()

  if (!agent) {
    throw NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  }
  return { agentId: agent.id, agentName: fullName(agent) }
}

function fullName(agent: { first_name?: string | null; last_name?: string | null } | null): string {
  if (!agent) return 'there'
  return [agent.first_name, agent.last_name].filter(Boolean).join(' ') || 'there'
}
