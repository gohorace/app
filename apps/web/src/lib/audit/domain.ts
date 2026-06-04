/**
 * Domain normalisation + validation, shared by the input field (client) and
 * the run endpoint (server). `example.com` and `https://www.example.com/path`
 * normalise to the same bare `example.com`.
 */

export function cleanDomain(raw: string): string {
  let s = (raw || '').trim().toLowerCase()
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '')
  s = s.replace(/\/.*$/, '').replace(/\s+/g, '')
  return s
}

/** at least name.tld, tld 2+ letters — matches the handoff's regex exactly. */
export function isValidDomain(raw: string): boolean {
  const d = cleanDomain(raw)
  return /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(d)
}

/** Truncate a domain for headline display past `n` chars, with an ellipsis. */
export function truncDomain(d: string, n: number): string {
  if (!d) return d
  return d.length > n ? d.slice(0, n - 1) + '…' : d
}
