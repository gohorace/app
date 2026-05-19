/**
 * Build pixel + click URLs for tracked-email injection (slice D).
 *
 * Hostname resolution:
 *   - Production:        r.<appHost>          (e.g. r.gohorace.com)
 *   - Vercel preview:    VERCEL_URL host      (no separate tracking subdomain
 *                                              for previews — they're tested
 *                                              by hitting the preview URL
 *                                              directly)
 *   - Local dev:         NEXT_PUBLIC_APP_URL  (typically http://localhost:3000)
 *
 * The middleware recognizes `r.<appHost>` as a system host so requests to
 * the tracking subdomain don't fall into the Doorstep custom-domain branch.
 */

import { signPixelToken, signClickToken } from './tokens'

/**
 * Return the host (no scheme) that serves /t/* paths for the current deploy.
 * Empty string if env is not configured — caller should fall back to the
 * primary app host.
 */
export function getTrackingHost(): string {
  const env = process.env.VERCEL_ENV

  // Preview + local dev: serve from the app's own host. No subdomain games.
  if (env === 'preview' && process.env.VERCEL_URL) {
    return process.env.VERCEL_URL
  }
  if (env === 'development' || !env) {
    try {
      return new URL(process.env.NEXT_PUBLIC_APP_URL ?? '').host
    } catch {
      return ''
    }
  }

  // Production (or anything else): derive r.<appHost> from NEXT_PUBLIC_APP_URL.
  try {
    const appHost = new URL(process.env.NEXT_PUBLIC_APP_URL ?? '').host
    return appHost ? `r.${appHost}` : ''
  } catch {
    return ''
  }
}

function trackingOrigin(): string {
  const host = getTrackingHost()
  if (!host) return ''
  // Localhost stays http; everything else gets https.
  const scheme = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https'
  return `${scheme}://${host}`
}

export function buildPixelUrl(sendId: string): string {
  return `${trackingOrigin()}/t/o/${signPixelToken(sendId)}`
}

export function buildClickUrl(sendId: string, urlIdx: number): string {
  return `${trackingOrigin()}/t/c/${signClickToken(sendId, urlIdx)}`
}

/**
 * True when `host` matches the production tracking subdomain pattern for the
 * current deploy (`r.<appHost>`). Used by the middleware to bypass the
 * Doorstep custom-domain branch for `r.gohorace.com`.
 */
export function isTrackingHost(host: string | null | undefined, appHost: string): boolean {
  if (!host || !appHost) return false
  return host.toLowerCase() === `r.${appHost.toLowerCase()}`
}
