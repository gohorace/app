/**
 * HOR-148 — POST /api/inspections
 *
 * Creates a Doorstep inspection from the agent's `/inspections/new` form.
 * Resolves the chosen address through the same `resolve_residence_property`
 * RPC as the contact/property flows so we never duplicate property rows.
 *
 * Body:
 *   {
 *     residence:        SelectedAddress,
 *     scheduled_at:     string,   // ISO timestamp
 *     duration_minutes: 15 | 30 | 60 (optional; omit for open-ended)
 *   }
 *
 * Response (201):
 *   { id: uuid, token: string, public_url: string }
 *
 * HOR-149 extends this response with a base64 `qr_png_data_url` for
 * instant on-page render. Token format (8-char base62) is unchanged —
 * the QR PNG just encodes the existing `public_url`.
 *
 * v1 forces `inspection_type='open_home'` server-side; the UI has no
 * selector. v2 (private inspections) adds a toggle.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveResidence, type SelectedAddressInput } from '@/lib/contacts/residence'
import { generate as generateToken } from '@/lib/inspections/tokens'
import { createInspection } from '@/lib/inspections/repo'
import { inspectionOrigin } from '@/lib/inspections/origin'

// Token collisions at 60^8 (~1.68e14 combos) are astronomically rare,
// but the schema's UNIQUE constraint will still raise 23505 if it
// happens. One retry is plenty.
const TOKEN_RETRY_LIMIT = 3

// Allowed duration values (minutes). Matches the UI <select>. Kept tight
// so the picker stays a single tap on mobile.
const ALLOWED_DURATIONS = [15, 30, 60] as const
type DurationMinutes = (typeof ALLOWED_DURATIONS)[number]

interface PostBody {
  residence?: SelectedAddressInput | null
  scheduled_at?: string
  duration_minutes?: number | null
  /** @deprecated — legacy clients may still send window_end_at; we honour it. */
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

  const { residence, scheduled_at, duration_minutes, window_end_at } = body

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

  const scheduledDate = new Date(scheduled_at)
  if (Number.isNaN(scheduledDate.getTime())) {
    return NextResponse.json({ error: 'scheduled_at is not a valid date' }, { status: 400 })
  }
  const scheduledIso = scheduledDate.toISOString()

  // Resolve window_end_at:
  //   - Prefer the new `duration_minutes` field (UI picker output)
  //   - Fall back to `window_end_at` ISO for legacy clients
  //   - Allow null/undefined → open-ended (no window cap)
  let windowEndIso: string | null = null
  if (duration_minutes != null) {
    if (!ALLOWED_DURATIONS.includes(duration_minutes as DurationMinutes)) {
      return NextResponse.json(
        { error: `duration_minutes must be one of ${ALLOWED_DURATIONS.join(', ')}` },
        { status: 400 },
      )
    }
    windowEndIso = new Date(
      scheduledDate.getTime() + duration_minutes * 60_000,
    ).toISOString()
  } else if (window_end_at) {
    const end = new Date(window_end_at)
    if (Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: 'window_end_at is not a valid date' }, { status: 400 })
    }
    if (end <= scheduledDate) {
      return NextResponse.json(
        { error: 'window_end_at must be after scheduled_at' },
        { status: 400 },
      )
    }
    windowEndIso = end.toISOString()
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

  const publicUrl = `${inspectionOrigin(req)}/i/${token}`

  return NextResponse.json({ id: inspectionId, token, public_url: publicUrl }, { status: 201 })
}
