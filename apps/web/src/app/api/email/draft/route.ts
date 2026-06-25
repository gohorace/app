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
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'
import {
  derivePretext,
  fetchRecentSoldBySuburb,
  fetchSoldAlts,
  getCachedSignalDraft,
  type SoldAlt,
} from '@/lib/ai/signal-draft'
import { composeSignatureHtml } from '@/lib/email/signature'
import type { ContentSource, ContentSourceAlt } from '@/lib/email/types'

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
    // Draft in the agent's configured voice + signature (gated above, so both
    // are present here). Makes the draft truly "in your voice". (HOR-356)
    // When the agent has an HTML signature configured, signal-draft suppresses
    // the plain-text append — the digest send wire splices the styled HTML on.
    voice: {
      brand_voice: profile.brand_voice,
      email_signature: profile.email_signature,
      email_signature_html: profile.email_signature_html,
    },
  })

  if (!draft) {
    // API key unset, model error, or the firewall held — the dock shows
    // `failed-draft` ("Horace couldn't draft this one").
    return NextResponse.json({ error: 'draft_unavailable' }, { status: 502 })
  }

  // HTML signature block (HOR-xxx) — returned alongside the body so the
  // composer dock can render a read-only preview below the editor and splice
  // it onto body_html at Send time. When the agent has no HTML signature
  // configured we fall back to the plain-text append (existing behaviour).
  const hasHtmlSignature =
    !!profile.email_signature_html || !!profile.email_signature_logo_url
  const signatureHtml = hasHtmlSignature
    ? composeSignatureHtml({
        html: profile.email_signature_html,
        logoUrl: profile.email_signature_logo_url,
      })
    : null
  const draftBody =
    !hasHtmlSignature && profile.email_signature
      ? `${draft.body}\n\n${profile.email_signature}`
      : draft.body

  // ── Insight & Content sources (composer V3 — Outreach Review re-skin) ──
  // The sold row populates from the same recent-sold pretext. `listings` and
  // `reports` come from HOR-383 (Site Content in Outreach), not built yet —
  // they ship as empty arrays so the panel renders gracefully today and the
  // rows light up automatically when the crawler lands.
  const sources = await buildContentSources(admin, auth.agentId, contact.suburb, pretext.source)

  return NextResponse.json(
    {
      subject: draft.subject,
      body: draftBody,
      pretext_label: pretext.label,
      sources,
      signature_html: signatureHtml,
    },
    { status: 200 },
  )
}

// ── Sources ────────────────────────────────────────────────────────────────

async function buildContentSources(
  admin: ReturnType<typeof createAdminClient>,
  agentId: string,
  suburb: string | null,
  pretextSource: string,
): Promise<ContentSource[]> {
  // Only the recent-sold pretext has real content to surface today. Other
  // pretexts (prior-relationship, local-intro) ship no rows — the panel
  // hides itself when sources are empty.
  if (pretextSource !== 'recent-sold' || !suburb) return []

  const alts = await fetchSoldAlts(admin, agentId, suburb, 5)
  if (alts.length === 0) return []

  const active = alts[0]
  const activeAddress = formatAddress(active, suburb)
  const activePrice = formatPrice(active.price)

  const altItems: ContentSourceAlt[] = alts.map((a) => ({
    id: a.id,
    label: formatAltLabel(a),
    address: formatAddress(a, suburb),
    price: formatPrice(a.price),
  }))

  return [
    {
      id: `sold:${active.id}`,
      type: 'sold',
      label: activePrice
        ? `Sold — ${activeAddress} · ${activePrice}`
        : `Sold — ${activeAddress}`,
      tag: 'relevant',
      address: activeAddress,
      price: activePrice,
      alts: altItems,
    },
  ]
}

function formatStreet(a: SoldAlt): string {
  return [a.street_number, a.street_name].filter(Boolean).join(' ').trim()
}

function formatAddress(a: SoldAlt, suburb: string): string {
  const street = formatStreet(a)
  return street ? `${street}, ${suburb}` : `a home in ${suburb}`
}

function formatAltLabel(a: SoldAlt): string {
  const street = formatStreet(a) || 'Recent sale'
  const price = formatPrice(a.price)
  return price ? `${street} · sold ${price}` : `${street} · recently sold`
}

/** Returns a price like `$2.34M` / `$840k`, or empty string when price is
 *  unknown (G-NAF imports usually have empty metadata). Callers should treat
 *  empty as "no price to display". */
function formatPrice(price: number | null): string {
  if (price == null || !Number.isFinite(price)) return ''
  if (price >= 1_000_000) {
    const m = price / 1_000_000
    return `$${m.toFixed(m >= 10 ? 1 : 2).replace(/\.?0+$/, '')}M`
  }
  if (price >= 1_000) {
    return `$${Math.round(price / 1000)}k`
  }
  return `$${price.toLocaleString('en-AU')}`
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
  const resolved = await resolvePrimaryAgent(admin, user.id, { requireWorkspace: true })
  if (!resolved) {
    throw NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  }
  // Re-fetch the agent's name by resolved id (resolvePrimaryAgent only returns id/workspace_id/seat_type).
  const { data: agent } = await admin
    .from('agents')
    .select('id, first_name, last_name')
    .eq('id', resolved.id)
    .maybeSingle()
  return { agentId: resolved.id, agentName: fullName(agent) }
}

function fullName(agent: { first_name?: string | null; last_name?: string | null } | null): string {
  if (!agent) return 'there'
  return [agent.first_name, agent.last_name].filter(Boolean).join(' ') || 'there'
}
