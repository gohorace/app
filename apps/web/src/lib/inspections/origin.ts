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
