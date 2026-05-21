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

/** True when the incoming request host is the neutral Doorstep host. */
export function isDoorstepHost(host: string | null | undefined): boolean {
  const configured = doorstepHost()
  return !!configured && !!host && host.toLowerCase() === configured
}
