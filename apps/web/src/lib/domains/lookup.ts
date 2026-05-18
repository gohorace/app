/**
 * HOR-204 — Host → workspace lookup with a short TTL cache.
 *
 * Middleware fires this on every non-app-host request to decide whether
 * the request is for a custom Doorstep domain. Each lookup hits the
 * Supabase REST API, so we cache the result in-process for 60 seconds.
 * Edge / Node module instances reset on cold start; that's fine — the
 * cache is purely best-effort latency reduction.
 *
 * Mutations to `workspace_custom_domains` (add / verify / delete) call
 * `invalidateHostLookup(hostname)` so the cache reflects the change on
 * the next request.
 */

import { createAdminClient } from '@/lib/supabase/admin'

interface LookupHit {
  workspaceId: string
  status: 'pending' | 'verifying' | 'verified' | 'failed' | 'removed'
  verifiedAt: string | null
  cachedAt: number
}

interface LookupMiss {
  cachedAt: number
  miss: true
}

type LookupEntry = LookupHit | LookupMiss

const TTL_MS = 60_000

// Stash the cache on globalThis so HMR / module-reload doesn't blow it
// away in dev. The leading "horace_" guards against collisions.
declare global {
  // eslint-disable-next-line no-var, @typescript-eslint/no-explicit-any
  var horace_domain_lookup_cache: Map<string, LookupEntry> | undefined
}

function getCache(): Map<string, LookupEntry> {
  if (!globalThis.horace_domain_lookup_cache) {
    globalThis.horace_domain_lookup_cache = new Map<string, LookupEntry>()
  }
  return globalThis.horace_domain_lookup_cache
}

export interface CustomDomainLookup {
  workspaceId: string
  status: LookupHit['status']
  verifiedAt: string | null
}

/**
 * Returns the lookup row for a hostname, or null when no row exists or
 * the row is not yet `verified`. Middleware uses this to gate the
 * rewrite — only verified domains proxy `/i/<token>`.
 *
 * Pass `{ requireVerified: false }` to also return pending/failed rows
 * (settings UI uses this).
 */
export async function getCustomDomain(
  hostname: string,
  opts: { requireVerified?: boolean } = { requireVerified: true },
): Promise<CustomDomainLookup | null> {
  const requireVerified = opts.requireVerified ?? true
  const key = hostname.toLowerCase()
  const cache = getCache()

  const cached = cache.get(key)
  if (cached && Date.now() - cached.cachedAt < TTL_MS) {
    if ('miss' in cached) return null
    if (requireVerified && cached.status !== 'verified') return null
    return {
      workspaceId: cached.workspaceId,
      status: cached.status,
      verifiedAt: cached.verifiedAt,
    }
  }

  // Miss / expired — fetch fresh.
  const admin = createAdminClient()
  const { data } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('workspace_custom_domains' as any)
    .select('workspace_id, status, verified_at')
    .eq('hostname', key)
    .neq('status', 'removed')
    .maybeSingle()

  if (!data) {
    cache.set(key, { cachedAt: Date.now(), miss: true })
    return null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any
  cache.set(key, {
    workspaceId: row.workspace_id,
    status: row.status,
    verifiedAt: row.verified_at,
    cachedAt: Date.now(),
  })

  if (requireVerified && row.status !== 'verified') return null

  return {
    workspaceId: row.workspace_id,
    status: row.status,
    verifiedAt: row.verified_at,
  }
}

/**
 * Drops the cache entry for a hostname. Call after any mutation that
 * changes whether the host should be treated as verified.
 */
export function invalidateHostLookup(hostname: string): void {
  const cache = getCache()
  cache.delete(hostname.toLowerCase())
}

/**
 * Returns the verified custom domain for a workspace, or null if none.
 * Used by the inspections origin helper to build the public capture URL.
 */
export async function getVerifiedDomainForWorkspace(
  workspaceId: string,
): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('workspace_custom_domains' as any)
    .select('hostname')
    .eq('workspace_id', workspaceId)
    .eq('status', 'verified')
    .maybeSingle()
  if (!data) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data as any).hostname as string) ?? null
}
