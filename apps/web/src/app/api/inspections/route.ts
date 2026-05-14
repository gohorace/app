/**
 * HOR-148 — POST /api/inspections
 *
 * Creates a Doorstep inspection (open home in v1) from the agent's
 * `/inspections/new` form. Resolves the chosen address through the same
 * `resolve_residence_property` RPC as the contact/property flows so we
 * never duplicate property rows.
 *
 * Body:
 *   {
 *     residence:      SelectedAddress,
 *     scheduled_at:   string,   // ISO timestamp
 *     window_end_at?: string    // ISO timestamp, optional
 *   }
 *
 * Response (201):
 *   { id: uuid, token: string, public_url: string }
 *
 * HOR-149 extends this response with a base64 `qr_png_data_url` for
 * instant on-page render. Token format (8-char base62) is unchanged —
 * the QR PNG just encodes the existing `public_url`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveResidence, type SelectedAddressInput } from '@/lib/contacts/residence'
import { generate as generateToken } from '@/lib/inspections/tokens'
import { createInspection } from '@/lib/inspections/repo'

// Token collisions at 60^8 (~1.68e14 combos) are astronomically rare,
// but the schema's UNIQUE constraint will still raise 23505 if it
// happens. One retry is plenty.
const TOKEN_RETRY_LIMIT = 3

interface PostBody {
  residence?: SelectedAddressInput | null
  scheduled_at?: string
  window_end_at?: string | null
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent || !agent.workspace_id) {
    return NextResponse.json({ error: 'No workspace for user' }, { status: 400 })
  }

  // ── Parse + validate ────────────────────────────────────────────────────────
  let body: PostBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const { residence, scheduled_at, window_end_at } = body

  if (!residence) {
    return NextResponse.json({ error: 'residence is required' }, { status: 400 })
  }

  const hasAnyAddress =
    Boolean(residence.google_place_id) ||
    Boolean(residence.street_number) ||
    Boolean(residence.street_name)   ||
    Boolean(residence.suburb)        ||
    Boolean(residence.postcode)      ||
    Boolean(residence.formatted)

  if (!hasAnyAddress) {
    return NextResponse.json({ error: 'Address is empty' }, { status: 400 })
  }

  if (!scheduled_at) {
    return NextResponse.json({ error: 'scheduled_at is required' }, { status: 400 })
  }

  // Parse + validate the timestamps as ISO. We accept anything Date can read
  // (e.g. `2026-05-15T14:30` from <input type="datetime-local">) and normalise.
  const scheduledIso = new Date(scheduled_at).toISOString()
  if (Number.isNaN(new Date(scheduledIso).getTime())) {
    return NextResponse.json({ error: 'scheduled_at is not a valid date' }, { status: 400 })
  }

  let windowEndIso: string | null = null
  if (window_end_at) {
    windowEndIso = new Date(window_end_at).toISOString()
    if (Number.isNaN(new Date(windowEndIso).getTime())) {
      return NextResponse.json({ error: 'window_end_at is not a valid date' }, { status: 400 })
    }
    if (new Date(windowEndIso) <= new Date(scheduledIso)) {
      return NextResponse.json(
        { error: 'window_end_at must be after scheduled_at' },
        { status: 400 },
      )
    }
  }

  // ── Resolve property (creates the row if address is new) ────────────────────
  const { propertyId, error: propErr } = await resolveResidence(admin, agent.workspace_id, residence)
  if (propErr) {
    return NextResponse.json({ error: `Address resolution failed: ${propErr}` }, { status: 500 })
  }
  if (!propertyId) {
    return NextResponse.json({ error: 'Could not resolve the address' }, { status: 422 })
  }

  // ── Generate token + insert inspection (retry on UNIQUE collision) ──────────
  let inspectionId: string | null = null
  let token: string | null = null
  let lastError: unknown = null

  for (let attempt = 0; attempt < TOKEN_RETRY_LIMIT; attempt++) {
    const candidate = generateToken()
    try {
      const created = await createInspection(admin, {
        workspaceId: agent.workspace_id,
        agentId: agent.id,
        propertyId,
        scheduledAt: scheduledIso,
        windowEndAt: windowEndIso,
        token: candidate,
      })
      inspectionId = created.id
      token = created.token
      break
    } catch (err) {
      lastError = err
      // 23505 = unique_violation. Anything else, bail.
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? (err as { code: string }).code
          : null
      if (code !== '23505') break
    }
  }

  if (!inspectionId || !token) {
    const msg = lastError instanceof Error ? lastError.message : 'createInspection failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // Build the public URL. Falls back to the request origin so deploys behind
  // preview/staging domains "just work". Production picks up `horace.app`
  // via NEXT_PUBLIC_APP_URL.
  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ??
    new URL(req.url).origin
  const publicUrl = `${origin}/i/${token}`

  return NextResponse.json({ id: inspectionId, token, public_url: publicUrl }, { status: 201 })
}
