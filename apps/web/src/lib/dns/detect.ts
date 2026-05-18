/**
 * HOR-204 — DNS provider detection from NS records.
 *
 * Server-side `dns.resolveNs()` lookup on the apex of the supplied
 * hostname, mapped to a known provider by NS-suffix matching. Used by
 * POST /api/domains to render provider-tailored CNAME instructions in
 * the pending state.
 *
 * Provider list is intentionally limited to the four we see most often
 * in Australian real-estate agents (anecdotal — log
 * `dns_provider_detected` to refine). Anything else maps to 'other'
 * and the UI falls back to generic instructions.
 *
 * This is purely a UI hint — never gate flow on the result. NS records
 * occasionally fail to resolve (private DNS, transient resolver issues)
 * and we shouldn't refuse to create the row in those cases.
 */

import { promises as dns } from 'dns'

export type DnsProvider =
  | 'cloudflare'
  | 'route53'
  | 'namecheap'
  | 'godaddy'
  | 'vercel'
  | 'other'
  | 'unknown'

interface ProviderPattern {
  provider: Exclude<DnsProvider, 'other' | 'unknown'>
  match: (nameservers: string[]) => boolean
}

const PROVIDERS: ProviderPattern[] = [
  {
    provider: 'cloudflare',
    match: (ns) => ns.some((n) => n.endsWith('.cloudflare.com')),
  },
  {
    provider: 'route53',
    match: (ns) => ns.some((n) => /\.awsdns-\d+\.(com|net|co\.uk|org)$/i.test(n)),
  },
  {
    provider: 'namecheap',
    match: (ns) =>
      ns.some(
        (n) =>
          n.endsWith('.registrar-servers.com') ||
          n.endsWith('.namecheaphosting.com'),
      ),
  },
  {
    provider: 'godaddy',
    match: (ns) => ns.some((n) => n.endsWith('.domaincontrol.com')),
  },
  {
    provider: 'vercel',
    match: (ns) => ns.some((n) => n.endsWith('.vercel-dns.com')),
  },
]

/**
 * Returns the DNS provider for the apex of the hostname, or 'unknown'
 * when the lookup fails and 'other' when the NS records don't match a
 * known provider.
 *
 * Apex extraction is naive: the last two labels for most TLDs, last
 * three for known suffixes that need them (`.com.au`, `.co.uk`, etc.).
 * Good enough for AU real-estate; if we add more markets we'll want a
 * proper public-suffix-list lookup.
 */
export async function detectDnsProvider(hostname: string): Promise<DnsProvider> {
  const apex = extractApex(hostname)
  if (!apex) return 'unknown'

  let nameservers: string[]
  try {
    nameservers = await dns.resolveNs(apex)
  } catch {
    return 'unknown'
  }

  const normalized = nameservers.map((n) => n.toLowerCase().replace(/\.$/, ''))
  for (const p of PROVIDERS) {
    if (p.match(normalized)) return p.provider
  }
  return 'other'
}

const MULTI_LABEL_TLDS = new Set([
  'com.au',
  'net.au',
  'org.au',
  'co.uk',
  'co.nz',
  'com.nz',
])

function extractApex(hostname: string): string | null {
  const h = hostname.trim().toLowerCase()
  if (!h.includes('.')) return null
  const parts = h.split('.')
  if (parts.length < 2) return null
  const lastTwo = parts.slice(-2).join('.')
  const lastThree = parts.slice(-3).join('.')
  // If the last two labels match a known multi-label TLD, the apex is
  // the last three labels (e.g. example.com.au).
  if (MULTI_LABEL_TLDS.has(lastTwo)) {
    return parts.length >= 3 ? lastThree : lastTwo
  }
  return lastTwo
}
