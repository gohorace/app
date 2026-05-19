/**
 * GET /t/c/[token]
 *
 * Click-tracking redirect. Resolves the token, looks up the target URL by
 * urlIdx in email_sends.links[], emits `email_clicked` via emit_email_event,
 * and 302s to the target URL with `_ri=<contact_tracked_links.token>` appended
 * so the recipient's landing on the agent's site stitches via the existing
 * HOR-104 path (stitch_contact_from_token).
 *
 * Unlike /t/o, this route DOES leak validity — a 410 on an invalid token is
 * fine here because clicks are recipient-initiated, not scanner prefetch.
 * We return a small explanatory HTML page rather than redirecting blindly.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyToken } from '@/lib/email/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PREFETCH_WINDOW_MS = 5_000

const KNOWN_BOT_UA_FRAGMENTS: string[] = [
  'Microsoft Outlook Safe Link Endpoint Application',
  'Mimecast',
  'Mail-Scanner',
  'Sophos',
  'Symantec',
]

function detectLikelyBot(userAgent: string | null, sentAt: string | null): boolean {
  if (userAgent && KNOWN_BOT_UA_FRAGMENTS.some((s) => userAgent.includes(s))) {
    return true
  }
  if (!sentAt) return false
  const ageMs = Date.now() - new Date(sentAt).getTime()
  return ageMs >= 0 && ageMs < PREFETCH_WINDOW_MS
}

function gonePage(message: string): NextResponse {
  return new NextResponse(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Link expired</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:8vh auto;padding:0 1rem;color:#1A1612;background:#F5F0E8}
h1{font-size:1.4rem;font-weight:600}p{color:#5A4D40;line-height:1.5;font-size:0.95rem}</style></head>
<body><h1>Link expired</h1><p>${message}</p></body></html>`,
    { status: 410, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

interface EmailSendForClick {
  id: string
  sent_at: string | null
  agent_id: string
  contact_id: string | null
  links: Array<{ url_id?: number; url: string; label?: string }> | null
}

export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  const parsed = verifyToken(params?.token ?? '')
  if (!parsed || parsed.urlIdx === 'p') {
    return gonePage('This link is malformed or expired.')
  }
  const urlIdx = parsed.urlIdx as number

  const admin = createAdminClient()

  const { data: send } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('email_sends' as any)
    .select('id, sent_at, agent_id, contact_id, links')
    .eq('id', parsed.sendId)
    .maybeSingle()

  if (!send) return gonePage('This link is no longer valid.')

  const row = send as unknown as EmailSendForClick

  // Resolve target URL. Slice D writes links as an array; the urlIdx in the
  // token is the index into that array (or matches links[*].url_id when the
  // composer set explicit ids).
  const target = resolveLinkUrl(row.links, urlIdx)
  if (!target) {
    return gonePage('The link in this email is no longer valid.')
  }

  let targetUrl: URL
  try {
    targetUrl = new URL(target)
  } catch {
    return gonePage('The destination URL for this link is malformed.')
  }

  // If we have a contact_id, look up the per-contact tracked link token and
  // append `_ri=…` so the agent-site tracker stitches the recipient via
  // stitch_contact_from_token. Skip silently if the contact has no token row
  // (e.g. ingested via a CSV that didn't mint one yet).
  if (row.contact_id) {
    const { data: link } = await admin
      .from('contact_tracked_links')
      .select('token')
      .eq('contact_id', row.contact_id)
      .maybeSingle()
    const token = (link as { token?: string } | null)?.token
    if (token && !targetUrl.searchParams.has('_ri')) {
      targetUrl.searchParams.set('_ri', token)
    }
  }

  // Fire the event before redirecting so we don't lose it on cold-shutdown
  // edge cases. emit_email_event no-ops on missing send / missing contact_id.
  const userAgent = req.headers.get('user-agent')
  await admin.rpc('emit_email_event', {
    p_send_id: parsed.sendId,
    p_event: 'email_clicked',
    p_props: {
      url: target,
      url_idx: urlIdx,
      user_agent: userAgent ?? null,
      likely_bot: detectLikelyBot(userAgent, row.sent_at),
    },
  })

  return NextResponse.redirect(targetUrl.toString(), { status: 302 })
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolveLinkUrl(
  links: EmailSendForClick['links'],
  urlIdx: number,
): string | null {
  if (!Array.isArray(links) || links.length === 0) return null
  // Prefer matching by url_id (the composer's explicit id) when present,
  // fall back to positional index. Both forms are valid for V1.
  const byId = links.find((l) => l && typeof l.url_id === 'number' && l.url_id === urlIdx)
  if (byId?.url) return byId.url
  const byPos = links[urlIdx]
  return byPos?.url ?? null
}
