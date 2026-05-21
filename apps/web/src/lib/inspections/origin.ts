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
 * Fallback chain (custom domain first, then preview, env, request, prod):
 *
 *   1. workspace verified custom domain (HOR-204)  — when workspaceId set
 *   2. https://<VERCEL_URL>  when VERCEL_ENV='preview' and VERCEL_URL set
 *   3. NEXT_PUBLIC_APP_URL   when set (prod / staging deploys)
 *   4. new URL(req.url).origin  when a request is available (covers local dev)
 *   5. 'https://gohorace.com'  last-resort fallback
 *
 * Call sites that have a workspaceId should pass it (await the async
 * variant). Call sites that don't (or where DB access is unavailable)
 * use the synchronous variant and accept the fallback chain.
 */

import { getVerifiedDomainForWorkspace } from '@/lib/domains/lookup'

export interface RequestLike {
  url: string
}

/**
 * HOR-282: the neutral public host for Doorstep capture surfaces
 * (onthedoorstep.app). This is the fallback origin when a workspace has
 * NOT verified its own custom domain — and it deliberately is NOT
 * `gohorace.com`. Keeping prospect-facing capture URLs off the Horace
 * brand is load-bearing for the invisibility invariant: a researching
 * vendor must never encounter the Horace name. (`inspectionOrigin` below
 * still resolves the Horace app host and is fine for agent-facing URLs.)
 *
 * Resolution order:
 *   1. https://<VERCEL_URL>          when VERCEL_ENV='preview' — so a QR
 *      minted on a preview deploy scans back to that same preview, which
 *      has the unmerged routes, not prod.
 *   2. NEXT_PUBLIC_DOORSTEP_HOST     prod = onthedoorstep.app (bare host or URL)
 *   3. new URL(req.url).origin       when a request is available (local dev)
 *   4. 'https://onthedoorstep.app'   last-resort
 */
export function doorstepOrigin(req?: RequestLike | null): string {
  if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  const configured = process.env.NEXT_PUBLIC_DOORSTEP_HOST?.trim().replace(/\/$/, '')
  if (configured) {
    return configured.startsWith('http') ? configured : `https://${configured}`
  }
  if (req && typeof req.url === 'string') {
    try {
      return new URL(req.url).origin
    } catch {
      // fall through
    }
  }
  return 'https://onthedoorstep.app'
}

/**
 * Resolves the public origin without considering a custom domain.
 * Keeps the existing call sites working until they're migrated to the
 * async variant. Prefer `inspectionOriginForWorkspace` when a workspace
 * id is available.
 */
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

/**
 * HOR-204: workspace-aware origin. Prefers the workspace's verified
 * custom domain when present; otherwise delegates to the sync fallback
 * chain above.
 *
 * Prefer `inspectionPublicUrl()` over this helper when you're building
 * the full public capture URL — it handles the path-shape difference
 * between custom-domain (root) and Horace-hosted (/i/) capture paths
 * in one place.
 */
export async function inspectionOriginForWorkspace(
  workspaceId: string,
  req?: RequestLike | null,
): Promise<string> {
  try {
    const hostname = await getVerifiedDomainForWorkspace(workspaceId)
    if (hostname) {
      return `https://${hostname}`
    }
  } catch (err) {
    console.error('inspectionOriginForWorkspace lookup failed', { workspaceId, err })
    // Fall through to the static chain — better to ship a usable URL
    // (even if Horace-hosted) than to error out the page.
  }
  return inspectionOrigin(req)
}

/**
 * HOR-204: single source of truth for the public capture URL.
 *
 * URL shape depends on whether the workspace has a verified custom
 * domain:
 *   - Custom domain:  https://inspections.<agent>.com/<token>
 *                     (the middleware on the custom host rewrites
 *                     /<token> → /i/<token> internally; the URL bar
 *                     stays short and branded)
 *   - Neutral host:   https://onthedoorstep.app/i/<token>  (HOR-282)
 *                     — never gohorace.com; see `doorstepOrigin`.
 *
 * Use this everywhere the URL is rendered — QR code, create-response
 * `public_url`, inspection detail page, daily-briefing links.
 */
export async function inspectionPublicUrl(
  workspaceId: string,
  token: string,
  req?: RequestLike | null,
): Promise<string> {
  try {
    const hostname = await getVerifiedDomainForWorkspace(workspaceId)
    if (hostname) {
      return `https://${hostname}/${token}`
    }
  } catch (err) {
    console.error('inspectionPublicUrl lookup failed', { workspaceId, token, err })
  }
  return `${doorstepOrigin(req)}/i/${token}`
}
