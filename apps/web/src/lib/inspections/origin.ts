/**
 * Doorstep public-URL origin resolution.
 *
 * The QR code, the public_url returned by the create endpoint, and the
 * URL the inline QR encodes on the detail page all need the canonical
 * origin for the current deploy. Pre-this-helper everywhere just read
 * `NEXT_PUBLIC_APP_URL` — fine on prod, fatal on Vercel previews where
 * that env var is pinned to `gohorace.com` by the project's env config.
 * Result: scanning a QR minted on a preview lands on prod, which (a)
 * doesn't have your unmerged middleware/route changes and (b) doesn't
 * know about your preview's new inspection rows.
 *
 * Fallback chain (preview first, then env, then request, then prod):
 *
 *   1. https://<VERCEL_URL>  when VERCEL_ENV='preview' and VERCEL_URL set
 *   2. NEXT_PUBLIC_APP_URL   when set (prod / staging deploys)
 *   3. new URL(req.url).origin  when a request is available (covers local dev)
 *   4. 'https://gohorace.com'  last-resort fallback
 */

export interface RequestLike {
  url: string
}

export function inspectionOrigin(req?: RequestLike | null): string {
  if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  if (fromEnv) return fromEnv
  if (req && typeof req.url === 'string') {
    try {
      return new URL(req.url).origin
    } catch {
      // fall through
    }
  }
  return 'https://gohorace.com'
}
