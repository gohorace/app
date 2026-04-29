import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyUnsubscribeToken } from '@/lib/outreach/unsubscribe'

export const runtime = 'nodejs'

function htmlPage(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:8vh auto;padding:0 1rem;color:#111}
h1{font-size:1.4rem}p{color:#444;line-height:1.5}</style></head>
<body><h1>${title}</h1>${body}</body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string; token: string } },
) {
  if (!verifyUnsubscribeToken(params.id, params.token)) {
    return htmlPage(
      'Invalid unsubscribe link',
      '<p>This unsubscribe link is invalid or has expired. If you keep getting messages you don’t want, reply to the sender.</p>',
      400,
    )
  }

  const admin = createAdminClient()
  const { data: contact } = await admin
    .from('contacts')
    .select('id, email, unsubscribed_at')
    .eq('id', params.id)
    .maybeSingle()

  if (!contact) {
    return htmlPage(
      'Already unsubscribed',
      '<p>You have been unsubscribed.</p>',
    )
  }

  if (!contact.unsubscribed_at) {
    await admin
      .from('contacts')
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq('id', params.id)
  }

  return htmlPage(
    'Unsubscribed',
    `<p>You won’t receive any more outreach to <strong>${contact.email ?? 'this address'}</strong> from this agent.</p>`,
  )
}
