/**
 * GET /t/o/[token]
 *
 * Open-tracking pixel. Returns a 43-byte transparent GIF on every hit —
 * including invalid tokens — so the validity of a guessed token is never
 * leaked back to a scanner.
 *
 * On a valid token, fires `email_opened` via emit_email_event with a
 * properties bag describing the user-agent + heuristic flags for
 * Apple Mail Privacy Protection (MPP) and bot prefetch. Slice F filters
 * the timeline by these flags so an MPP "preview" isn't presented as a
 * real read.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyToken } from '@/lib/email/tokens'
import { TRANSPARENT_GIF } from '@/lib/email/pixel'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── Pixel response helper ───────────────────────────────────────────────────

function pixelResponse(): NextResponse {
  // Wrap in Uint8Array so Node 22+'s Buffer<ArrayBufferLike> shape doesn't
  // clash with NextResponse's BodyInit signature.
  return new NextResponse(new Uint8Array(TRANSPARENT_GIF), {
    status: 200,
    headers: {
      'content-type': 'image/gif',
      'content-length': String(TRANSPARENT_GIF.length),
      'cache-control': 'no-store, no-cache, must-revalidate, private',
      'pragma': 'no-cache',
      'expires': '0',
      // Image-proxies (Apple Mail, Gmail) ignore these but document intent.
      'x-content-type-options': 'nosniff',
    },
  })
}

// ── MPP + bot heuristics ────────────────────────────────────────────────────

const APPLE_MPP_UA_PATTERNS: RegExp[] = [
  // Apple's image proxy sometimes self-identifies; conservative match.
  /MailPrivacyProtection/i,
  /Mail Privacy/i,
]

// Pre-delivery scanner User-Agents — these clients fetch images BEFORE the
// recipient sees the email (anti-malware / link-rewriting / safe-link checks).
// Treating their hits as "opens" would overcount engagement.
//
// Gmail's image proxy (GoogleImageProxy / ggpht.com) is NOT in this list:
// it's the legitimate Gmail render path that fetches when a real user views
// the message. Bucketing it as a bot mislabelled real Gmail opens as "Link
// prefetched by a scanner" — caught on slice F end-to-end smoke 2026-05-19.
const KNOWN_BOT_UA_FRAGMENTS: string[] = [
  'Microsoft Outlook Safe Link Endpoint Application',
  'Mimecast',
  'Mail-Scanner',
  'Sophos',
  'Symantec',
]

const PREFETCH_WINDOW_MS = 5_000

function detectAppleMpp(userAgent: string | null, referer: string | null): boolean {
  if (!userAgent) return false
  if (APPLE_MPP_UA_PATTERNS.some((re) => re.test(userAgent))) return true
  // Heuristic fallback: Apple Mail UA with no referer and no obvious browser
  // signature. Best-effort; slice F surfaces this as a flag, not a verdict.
  if (
    /Macintosh.*AppleWebKit/.test(userAgent) &&
    !referer &&
    !/Chrome|Firefox|Edge|Opera/.test(userAgent)
  ) {
    return true
  }
  return false
}

function detectLikelyBot(userAgent: string | null, sentAt: string | null): boolean {
  if (userAgent && KNOWN_BOT_UA_FRAGMENTS.some((s) => userAgent.includes(s))) {
    return true
  }
  if (!sentAt) return false
  const ageMs = Date.now() - new Date(sentAt).getTime()
  return ageMs >= 0 && ageMs < PREFETCH_WINDOW_MS
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  const parsed = verifyToken(params?.token ?? '')
  if (!parsed || parsed.urlIdx !== 'p') {
    return pixelResponse() // never leak validity
  }

  const userAgent = req.headers.get('user-agent')
  const referer = req.headers.get('referer')

  const admin = createAdminClient()

  // Load the send to compute the bot heuristic and to confirm the row exists.
  // (emit_email_event also no-ops on missing send_id; this extra lookup lets
  // us compute properties.likely_bot and is cheap on the PK index.)
  const { data: send } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('email_sends' as any)
    .select('id, sent_at')
    .eq('id', parsed.sendId)
    .maybeSingle()

  if (!send) {
    // Token verified but row is gone (purged / never landed). Still return
    // the pixel — same reason as invalid-token: no validity leak.
    return pixelResponse()
  }

  const sentAtRow = (send as { sent_at: string | null }).sent_at
  const props: Record<string, unknown> = {
    user_agent: userAgent ?? null,
    apple_mpp: detectAppleMpp(userAgent, referer),
    likely_bot: detectLikelyBot(userAgent, sentAtRow),
  }

  // Fire and forget — emit_email_event handles missing contact_id by no-op.
  // We don't await the result for status, but we DO await for ordering so
  // the response doesn't race a serverless function cold-shutdown.
  // RPC cast: slice A's emit_email_event isn't in the generated Database
  // types yet (database.types.ts is stale post-slice-A); drop the cast once
  // types are regenerated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.rpc as any)('emit_email_event', {
    p_send_id: parsed.sendId,
    p_event: 'email_opened',
    p_props: props,
  })

  return pixelResponse()
}
