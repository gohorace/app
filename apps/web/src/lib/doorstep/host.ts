/**
 * HOR-282: the neutral Doorstep public host.
 *
 * Single source of truth for parsing NEXT_PUBLIC_DOORSTEP_HOST (prod =
 * onthedoorstep.app). Shared by the middleware (which gates which paths
 * the host may serve) and the host-aware /privacy + /contact pages (which
 * render a neutral, Horace-free variant on this host). Pure — no runtime
 * deps — so it's safe to import from middleware.
 */

/** Parsed bare lowercase host, or '' when unconfigured (e.g. local dev). */
export function doorstepHost(): string {
  const raw = process.env.NEXT_PUBLIC_DOORSTEP_HOST?.trim().toLowerCase()
  if (!raw) return ''
  try {
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`).host
  } catch {
    return raw
  }
}

/** Strip a leading `www.` so apex and www variants compare equal. */
function bareHost(h: string): string {
  return h.startsWith('www.') ? h.slice(4) : h
}

/**
 * True when the incoming request host is the neutral Doorstep host.
 *
 * `www`-insensitive: the apex `onthedoorstep.app` 307-redirects to
 * `www.onthedoorstep.app` at the Vercel edge (same as gohorace.com → www),
 * so the host that actually reaches middleware is the www form even when
 * NEXT_PUBLIC_DOORSTEP_HOST is the bare apex. Matching both keeps the
 * neutral surfaces working regardless of which variant Vercel canonicalises
 * to. (Mirrors the `www.`-stripping in the email tracking-host derivation.)
 */
export function isDoorstepHost(host: string | null | undefined): boolean {
  const configured = doorstepHost()
  if (!configured || !host) return false
  return bareHost(host.toLowerCase()) === bareHost(configured)
}
