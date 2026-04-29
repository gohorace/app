import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { appendCampaignToken } from '@/lib/outreach/links'

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

  let target = link.target_url

  // If the link is bound to a contact, append the campaign token so the
  // tracker can stitch identity on click. Reuses existing campaign_tokens
  // (one per contact per campaign) when a campaign is set.
  if (link.contact_id && link.campaign_id) {
    const { data: tok } = await admin
      .from('campaign_tokens')
      .select('token')
      .eq('campaign_id', link.campaign_id)
      .eq('contact_id', link.contact_id)
      .maybeSingle()
    if (tok?.token) target = appendCampaignToken(target, tok.token)
  }

  return NextResponse.redirect(target, { status: 302 })
}
