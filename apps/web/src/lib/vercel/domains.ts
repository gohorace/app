/**
 * HOR-204 — Vercel Domains API wrapper.
 *
 * Thin layer over the four endpoints we need to provision a custom
 * domain for a Doorstep capture page:
 *
 *   addDomain        POST   /v10/projects/:projectId/domains
 *   getDomainStatus  GET    /v9/projects/:projectId/domains/:domain
 *                    GET    /v6/domains/:domain/config
 *   verifyDomain     POST   /v9/projects/:projectId/domains/:domain/verify
 *   removeDomain     DELETE /v9/projects/:projectId/domains/:domain
 *
 * SSL is handled automatically by Vercel (Let's Encrypt). We never
 * touch ACME challenges directly.
 *
 * Env vars (all server-only):
 *   VERCEL_API_TOKEN  — personal or team-scoped token
 *   VERCEL_PROJECT_ID — the gohorace.com Vercel project
 *   VERCEL_TEAM_ID    — required if the project sits under a team
 *
 * Errors are surfaced as thrown errors with structured `code` and
 * `httpStatus` properties so callers can map to friendly UI states.
 */

const VERCEL_API = 'https://api.vercel.com'

export class VercelDomainError extends Error {
  code: string
  httpStatus: number
  constructor(code: string, httpStatus: number, message: string) {
    super(message)
    this.name = 'VercelDomainError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

interface VercelEnv {
  token: string
  projectId: string
  teamId: string | null
}

function getEnv(): VercelEnv {
  const token = process.env.VERCEL_API_TOKEN
  const projectId = process.env.VERCEL_PROJECT_ID
  if (!token) throw new VercelDomainError('env_missing', 500, 'VERCEL_API_TOKEN not set')
  if (!projectId) throw new VercelDomainError('env_missing', 500, 'VERCEL_PROJECT_ID not set')
  return {
    token,
    projectId,
    teamId: process.env.VERCEL_TEAM_ID ?? null,
  }
}

function teamQuery(env: VercelEnv): string {
  return env.teamId ? `?teamId=${encodeURIComponent(env.teamId)}` : ''
}

function teamQueryAmp(env: VercelEnv): string {
  return env.teamId ? `&teamId=${encodeURIComponent(env.teamId)}` : ''
}

async function vercelFetch<T>(
  url: string,
  init: RequestInit & { method: string },
  env: VercelEnv,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.token}`,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
    cache: 'no-store',
  })
  if (!res.ok) {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      body = await res.text()
    }
    // Vercel error shape: { error: { code, message } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = (body as any)?.error
    const code = err?.code ?? 'vercel_error'
    const message = err?.message ?? `Vercel API ${res.status}`
    throw new VercelDomainError(code, res.status, message)
  }
  return (await res.json()) as T
}

export interface VercelVerificationRecord {
  type: string
  domain: string
  value: string
  reason: string
}

export interface VercelDomain {
  name: string
  apexName: string
  verified: boolean
  verification?: VercelVerificationRecord[]
}

export interface DomainAddResult {
  hostname: string
  verified: boolean
  verificationRecords: VercelVerificationRecord[]
}

/**
 * Register a hostname against the Horace Vercel project. Returns the
 * verification records Vercel needs the user to add to DNS (commonly
 * just a CNAME to cname.vercel-dns.com). If the hostname already
 * verified before this call (e.g. apex points at Vercel already), we
 * return verified=true and an empty records array.
 */
export async function addDomain(hostname: string): Promise<DomainAddResult> {
  const env = getEnv()
  const url = `${VERCEL_API}/v10/projects/${env.projectId}/domains${teamQuery(env)}`
  const data = await vercelFetch<VercelDomain>(
    url,
    {
      method: 'POST',
      body: JSON.stringify({ name: hostname }),
    },
    env,
  )
  return {
    hostname: data.name,
    verified: data.verified,
    verificationRecords: data.verification ?? [],
  }
}

export interface DomainStatus {
  /** Verified at Vercel level (DNS resolves to a known target). */
  verified: boolean
  /** True when DNS is misconfigured — overrides verified=true if set. */
  misconfigured: boolean
  /** Whether Vercel's SSL cert is issued and active. */
  sslActive: boolean
  /** Raw verification records, when still un-verified. */
  verificationRecords: VercelVerificationRecord[]
}

interface DomainConfigResponse {
  misconfigured?: boolean
  acceptedChallenges?: string[]
}

/**
 * Returns the current verification + SSL status. Two API calls:
 *   /v9/projects/:id/domains/:domain  → verified + verification
 *   /v6/domains/:domain/config        → misconfigured (DNS reachability)
 *
 * SSL state is derived: Vercel issues a cert as soon as verified+!misconfigured
 * is true, so we treat that as ssl active. UI can poll if it wants a
 * tighter signal.
 */
export async function getDomainStatus(hostname: string): Promise<DomainStatus> {
  const env = getEnv()
  const projectDomainUrl = `${VERCEL_API}/v9/projects/${env.projectId}/domains/${encodeURIComponent(hostname)}${teamQuery(env)}`
  const configUrl = `${VERCEL_API}/v6/domains/${encodeURIComponent(hostname)}/config${teamQuery(env)}`

  const [domain, config] = await Promise.all([
    vercelFetch<VercelDomain>(projectDomainUrl, { method: 'GET' }, env),
    vercelFetch<DomainConfigResponse>(configUrl, { method: 'GET' }, env),
  ])

  const verified = !!domain.verified
  const misconfigured = !!config.misconfigured
  return {
    verified,
    misconfigured,
    sslActive: verified && !misconfigured,
    verificationRecords: domain.verification ?? [],
  }
}

/**
 * Forces Vercel to re-run its DNS / verification check. Useful when
 * the user has just updated their DNS and wants instant feedback.
 */
export async function verifyDomain(hostname: string): Promise<DomainStatus> {
  const env = getEnv()
  const url = `${VERCEL_API}/v9/projects/${env.projectId}/domains/${encodeURIComponent(hostname)}/verify${teamQuery(env)}`
  await vercelFetch<VercelDomain>(url, { method: 'POST' }, env)
  // The /verify response only reports verified state. Combine with
  // /config for SSL state in one call to getDomainStatus.
  return await getDomainStatus(hostname)
}

/**
 * Detach the domain from the Vercel project. Releases the SSL cert.
 * Idempotent — calling on an already-removed domain returns true.
 */
export async function removeDomain(hostname: string): Promise<boolean> {
  const env = getEnv()
  const url = `${VERCEL_API}/v9/projects/${env.projectId}/domains/${encodeURIComponent(hostname)}${teamQueryAmp(env).replace('&', '?')}`
  try {
    await vercelFetch(url, { method: 'DELETE' }, env)
    return true
  } catch (err) {
    if (err instanceof VercelDomainError && err.httpStatus === 404) {
      return true // idempotent
    }
    throw err
  }
}

/**
 * Light hostname validation suitable for client + server.
 * RFC 1123 subset: labels of [a-z0-9-], each 1-63 chars, no leading/trailing
 * hyphens, at least one dot.
 */
export function isValidHostname(hostname: string): boolean {
  if (typeof hostname !== 'string') return false
  const h = hostname.trim().toLowerCase()
  if (h.length === 0 || h.length > 253) return false
  if (!h.includes('.')) return false
  const labels = h.split('.')
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return false
  }
  return true
}
