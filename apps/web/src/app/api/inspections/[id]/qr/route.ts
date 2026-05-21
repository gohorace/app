/**
 * HOR-149 — GET /api/inspections/[id]/qr
 *
 * Returns a printable PNG QR code for an inspection's public capture
 * URL (`<origin>/i/<token>`). Auth-scoped to the owning agent; service
 * role is not used here because this is an authenticated browser
 * download, not a public/embed surface.
 *
 * Response:
 *   200 image/png — Content-Disposition: attachment; filename="open-home-..."
 *   401 if not signed in
 *   404 if inspection doesn't exist OR belongs to a different agent
 *   500 if QR generation hiccups
 *
 * v1 only ships the GET (download / right-click → Save Image). HOR-150
 * adds an inline data URL to the POST /api/inspections response so the
 * detail page can render the QR without a second fetch.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { qrPngBuffer, buildQrFilename } from '@/lib/inspections/qr'
import { doorstepOrigin, inspectionPublicUrl } from '@/lib/inspections/origin'

export const dynamic = 'force-dynamic'

interface Ctx {
  params: Promise<{ id: string }>
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing inspection id' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'No agent record' }, { status: 401 })

  // Pre-types-regen casts: see HOR-147 repo.ts for the same workaround.
  const { data: inspectionRow, error } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('inspections' as never)
    .select('id, agent_id, token, scheduled_at, deleted_at, property_id')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[qr] inspection lookup error:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inspection = inspectionRow as any
  // 404 deliberately covers "not yours" — don't leak existence to other agents.
  if (!inspection || inspection.deleted_at || inspection.agent_id !== agent.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: property } = await admin
    .from('properties')
    .select('street_number, street_name, suburb')
    .eq('id', inspection.property_id)
    .maybeSingle()

  const publicUrl = agent.workspace_id
    ? await inspectionPublicUrl(agent.workspace_id, inspection.token, req)
    : `${doorstepOrigin(req)}/i/${inspection.token}`

  let png: Buffer
  try {
    png = await qrPngBuffer(publicUrl)
  } catch (err) {
    console.error('[qr] generation failed:', err)
    return NextResponse.json({ error: 'Could not render QR' }, { status: 500 })
  }

  const filename = buildQrFilename({
    streetNumber: property?.street_number ?? null,
    streetName: property?.street_name ?? null,
    suburb: property?.suburb ?? null,
    scheduledAt: inspection.scheduled_at,
    token: inspection.token,
  })

  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': png.length.toString(),
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Don't cache — agents may regenerate after token rotation in future.
      'Cache-Control': 'private, no-store',
    },
  })
}
