/**
 * HTML link rewriter + pixel injector for tracked-email sends.
 *
 * Input: TipTap-generated (and DOMPurify-sanitized) HTML fragment plus an
 * email_send_id. Output: rewritten HTML where each `<a href>` points at
 * `r.gohorace.com/t/c/<token>` (preserving everything else), a 1×1 hidden
 * `<img>` is appended that points at `r.gohorace.com/t/o/<token>`, and a
 * `links` array maps url_id → original URL for later resolution.
 *
 * Skipping rules — these href schemes / patterns pass through unchanged:
 *   - `mailto:` / `tel:` / `sms:`         (non-http schemes)
 *   - `#anchor` only                       (in-page anchor)
 *   - `data:` URIs                         (inline data)
 *   - `r.<appHost>/t/...`                  (already-tracked — must not double-wrap)
 *
 * Implementation notes:
 *   - We use a tightly-bounded regex over the HTML string rather than pulling
 *     in jsdom / parse5 / cheerio. TipTap output is well-formed and the
 *     href attribute is always quoted; the regex is unambiguous.
 *   - The regex matches `href="..."` (the most common form TipTap emits)
 *     plus `href='...'` for paste robustness. Unquoted hrefs are not handled
 *     (TipTap doesn't emit them).
 *   - We escape the rewritten URL using the existing href quote character to
 *     preserve well-formed HTML.
 */

import { signClickToken, signPixelToken } from './tokens'
import { getTrackingHost } from './tracking-urls'
import type { EmailSendLink } from './types'

export interface RewriteInput {
  emailSendId: string
  bodyHtml: string
}

export interface RewriteResult {
  /** Final HTML to ship in the MIME body (links rewritten + pixel appended). */
  bodyHtml: string
  /** Map of url_id → original URL. Stored on email_sends.links jsonb. */
  links: EmailSendLink[]
}

const HREF_REGEX = /\bhref\s*=\s*(["'])([^"']*)\1/gi

export function rewriteAndInjectPixel(input: RewriteInput): RewriteResult {
  const { emailSendId, bodyHtml } = input
  const trackingHost = getTrackingHost()
  const tcOrigin = trackingHost.startsWith('localhost') || trackingHost.startsWith('127.0.0.1')
    ? `http://${trackingHost}`
    : `https://${trackingHost}`
  const trackedPrefix = `${tcOrigin}/t/`

  const links: EmailSendLink[] = []
  let nextUrlId = 0

  const rewritten = bodyHtml.replace(HREF_REGEX, (match, quote: string, urlValue: string) => {
    const url = urlValue.trim()
    if (!url) return match
    if (shouldSkipUrl(url, trackedPrefix)) return match

    const urlId = nextUrlId++
    links.push({ url_id: urlId, url })
    const token = signClickToken(emailSendId, urlId)
    const replaced = `${tcOrigin}/t/c/${token}`
    // Quote whatever was already there; URL is HMAC-derived so no special chars.
    return `href=${quote}${replaced}${quote}`
  })

  const pixelToken = signPixelToken(emailSendId)
  const pixelTag =
    `<img src="${tcOrigin}/t/o/${pixelToken}" width="1" height="1" ` +
    `style="display:none;border:0;visibility:hidden" alt="" />`

  const withPixel = appendPixel(rewritten, pixelTag)

  return { bodyHtml: withPixel, links }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function shouldSkipUrl(url: string, trackedPrefix: string): boolean {
  const lower = url.toLowerCase()
  if (lower.startsWith('mailto:')) return true
  if (lower.startsWith('tel:')) return true
  if (lower.startsWith('sms:')) return true
  if (lower.startsWith('data:')) return true
  if (lower.startsWith('javascript:')) return true
  if (url.startsWith('#')) return true              // in-page anchor
  if (lower.startsWith(trackedPrefix.toLowerCase())) return true   // already tracked
  // Heuristic: protocol-relative or relative URLs without a scheme are also
  // skipped — TipTap-generated links always carry an absolute scheme; relative
  // links here are paste artefacts and rewriting them would resolve against
  // r.gohorace.com (wrong domain) once the recipient clicks.
  if (!/^https?:\/\//i.test(url)) return true
  return false
}

/**
 * Append the pixel `<img>` to the HTML. If a closing `</body>` is present
 * insert just before it; otherwise append at the end of the fragment.
 * TipTap output is a fragment (no <body>), so we usually take the else
 * branch — included for robustness.
 */
function appendPixel(html: string, pixelTag: string): string {
  const closingBody = /<\/body\s*>/i
  if (closingBody.test(html)) {
    return html.replace(closingBody, `${pixelTag}$&`)
  }
  return `${html}${pixelTag}`
}
