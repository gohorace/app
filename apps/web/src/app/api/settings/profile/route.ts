/**
 * PATCH /api/settings/profile — save the agent's brand voice + signature
 * (and optional website / positioning) to agent_settings.
 *
 * These power Horace's email drafting (lib/ai/signal-draft.ts) and gate the
 * composer dock's `setup` state.
 *
 * Signature shape (HOR-xxx): the editor sends `email_signature_html` (rich
 * HTML) plus an optional `email_signature_logo_url`. We sanitise the HTML
 * server-side, validate the URL (HEAD + image content-type), and derive a
 * plain-text fallback into the legacy `email_signature` column so unchanged
 * consumers (MCP tools, outreach drafts, the V2 composer) keep producing
 * readable signatures.
 *
 * Cookie-session auth (settings is a UI-only surface). Empty string clears a
 * field (→ null), which re-arms the dock's setup state.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'
import {
  sanitiseSignatureHtml,
  signatureToPlainText,
} from '@/lib/email/signature'
import { validateLogoUrl, logoUrlErrorMessage } from '@/lib/email/validate-logo-url'
import { z } from 'zod'

const schema = z
  .object({
    brand_voice: z.string().max(1000).optional(),
    email_signature_html: z.string().max(10_000).optional(),
    email_signature_logo_url: z.string().max(2_000).optional(),
    /** Direct edits of the legacy plain-text field are still honoured for any
     *  caller that hasn't switched to the HTML editor (e.g. the MCP onboarding
     *  tool round-trips this). Ignored when html is supplied. */
    email_signature: z.string().max(2_000).optional(),
    website_url: z.string().max(500).optional(),
    market_positioning: z.string().max(1000).optional(),
  })
  .strict()

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const update: Record<string, string | null> = {}

  // Plain-text scalars — empty string clears the field.
  for (const k of ['brand_voice', 'website_url', 'market_positioning'] as const) {
    const v = parsed.data[k]
    if (typeof v === 'string') update[k] = v.trim() || null
  }

  // Signature trio (HOR-xxx). Sanitise HTML, validate URL, derive plain text.
  // When `email_signature_html` is supplied, it's authoritative and drives the
  // plain-text fallback. When only the legacy `email_signature` is supplied,
  // we honour it on its own (no html derivation — that would lock direct
  // text-only writers out of the editor's surface).
  if (typeof parsed.data.email_signature_html === 'string') {
    const cleanedHtml = sanitiseSignatureHtml(parsed.data.email_signature_html)
    update.email_signature_html = cleanedHtml || null
    update.email_signature = cleanedHtml ? signatureToPlainText(cleanedHtml) || null : null
  } else if (typeof parsed.data.email_signature === 'string') {
    update.email_signature = parsed.data.email_signature.trim() || null
  }

  if (typeof parsed.data.email_signature_logo_url === 'string') {
    const raw = parsed.data.email_signature_logo_url.trim()
    if (!raw) {
      update.email_signature_logo_url = null
    } else {
      const result = await validateLogoUrl(raw)
      if (!result.ok) {
        return NextResponse.json(
          { error: logoUrlErrorMessage(result.error), code: result.error },
          { status: 400 },
        )
      }
      update.email_signature_logo_url = result.url
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const admin = createAdminClient()
  const agentRow = await resolvePrimaryAgent(admin, user.id)
  if (!agentRow) return NextResponse.json({ error: 'No agent found' }, { status: 400 })

  const { error } = await admin
    .from('agent_settings')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .upsert({ agent_id: agentRow.id, ...update } as any, { onConflict: 'agent_id' })

  if (error) {
    console.error('Profile settings patch error:', error)
    return NextResponse.json({ error: error.message ?? 'Failed to save' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
