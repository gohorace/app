import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

/**
 * GET /api/debug/inbound-samples
 *
 * Returns the most recent inbound email captures for the HOR-28 spike.
 * Auth: any logged-in user. (Earlier optional DEBUG_ALLOWED_USER_IDS
 * allowlist removed — Vercel sensitive-env-var state proved confusing
 * during the spike. Re-add proper auth before this goes near prod.)
 *
 * Query params:
 *   ?limit=50              max rows (default 50, cap 200)
 *   ?portal=rea|domain     filter by source_portal
 *   ?raw=1                 include raw_mime in the response (omitted by default)
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const rawLimit = Number(params.get('limit') ?? '50')
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 200)
  const portal = params.get('portal')
  const includeRaw = params.get('raw') === '1'

  const admin = createAdminClient()
  let query = admin
    .from('inbound_email_samples')
    .select(
      includeRaw
        ? 'id, received_at, to_address, from_address, subject, message_id, source_portal, parsed, raw_mime'
        : 'id, received_at, to_address, from_address, subject, message_id, source_portal, parsed',
    )
    .order('received_at', { ascending: false })
    .limit(limit)

  if (portal) query = query.eq('source_portal', portal)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ count: data?.length ?? 0, samples: data ?? [] })
}
