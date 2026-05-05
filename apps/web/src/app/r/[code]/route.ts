import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: { code: string } },
) {
  const admin = createAdminClient()

  const { data, error } = await admin.rpc('click_short_link', { p_code: params.code })
  const link = data?.[0]
  if (error || !link) {
    return new NextResponse('Link not found', { status: 404 })
  }

  return NextResponse.redirect(link.target_url, { status: 302 })
}
