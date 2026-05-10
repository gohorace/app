import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Per-contact tracked link.
//   GET /c/{token}
//
// Resolves the token, bumps click_count + last_clicked_at, and 302s to the
// destination. The actual identity stitch happens later when the visitor's
// browser hits the agent's tracked site — the tracker reads `_ri` from the
// URL and forwards it on the next /api/t beacon, where stitch_contact_from_token
// writes the identity_map row.

function notFound(message: string) {
  return new NextResponse(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Link not found</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:8vh auto;padding:0 1rem;color:#1A1612;background:#F5F0E8}
h1{font-size:1.4rem;font-weight:600}p{color:#5A4D40;line-height:1.5;font-size:0.95rem}</style></head>
<body><h1>Link not found</h1><p>${message}</p></body></html>`,
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

export async function GET(
  _req: Request,
  { params }: { params: { token: string } },
) {
  const token = params.token?.trim()
  if (!token) return notFound('This link is invalid.')

  const admin = createAdminClient()

  const { data, error } = await admin.rpc('resolve_contact_link_click', { p_token: token })
  const row = Array.isArray(data) ? data[0] : null

  if (error || !row) {
    return notFound('This link is no longer valid. The contact may have been removed.')
  }

  const target = row.destination_url || row.default_url
  if (!target) {
    return notFound("This agent hasn't configured a default site URL yet.")
  }

  // Append the campaign token as a query param so the tracker on the
  // destination site can pick it up and stitch on its next beacon. The
  // tracker reads `_ri` (see apps/tracker/src/tracker.ts).
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return notFound('The destination URL for this link is malformed.')
  }
  url.searchParams.set('_ri', token)

  return NextResponse.redirect(url.toString(), { status: 302 })
}
