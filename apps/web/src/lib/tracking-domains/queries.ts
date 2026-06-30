/**
 * First-party tracking domains — read-only data access (W2).
 *
 * Reads from `workspace_domains` (the Cloudflare-based tracking hostname
 * table — distinct from the Vercel-based `workspace_custom_domains` used
 * for Doorstep). PR 1 is read-only: the admin settings page renders status.
 * Provisioning / mutation helpers land with the Cloudflare service in PR 2.
 *
 * The generated Supabase types don't yet include `workspace_domains`, so we
 * cast the table name and shape the row by hand — same pattern the
 * custom-domain lookups use (lib/domains/lookup.ts).
 */

import { createAdminClient } from '@/lib/supabase/admin'

export type TrackingDomainStatus =
  | 'pending'
  | 'verifying'
  | 'active'
  | 'failed'
  | 'deleted'

export type TrackingCertStatus = 'pending' | 'issued' | 'renewing' | 'failed'

export interface TrackingDomain {
  id: string
  workspaceId: string
  hostname: string
  apexDomain: string
  status: TrackingDomainStatus
  certStatus: TrackingCertStatus | null
  certIssuedAt: string | null
  verificationRecordName: string | null
  verificationRecordValue: string | null
  lastCheckedAt: string | null
  failureReason: string | null
  createdAt: string
  activatedAt: string | null
}

interface TrackingDomainRowFromDb {
  id: string
  workspace_id: string
  hostname: string
  apex_domain: string
  status: TrackingDomainStatus
  cert_status: TrackingCertStatus | null
  cert_issued_at: string | null
  verification_record_name: string | null
  verification_record_value: string | null
  last_checked_at: string | null
  failure_reason: string | null
  created_at: string
  activated_at: string | null
}

function mapRow(row: TrackingDomainRowFromDb): TrackingDomain {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    hostname: row.hostname,
    apexDomain: row.apex_domain,
    status: row.status,
    certStatus: row.cert_status,
    certIssuedAt: row.cert_issued_at,
    verificationRecordName: row.verification_record_name,
    verificationRecordValue: row.verification_record_value,
    lastCheckedAt: row.last_checked_at,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
  }
}

/**
 * All non-deleted tracking domains for a workspace, newest first.
 * Today a workspace has at most one, but the table allows mid-swap rows
 * so the settings UI reads a list.
 */
export async function listTrackingDomains(
  workspaceId: string,
): Promise<TrackingDomain[]> {
  const admin = createAdminClient()
  const { data } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('workspace_domains' as any)
    .select('*')
    .eq('workspace_id', workspaceId)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false })

  return ((data as TrackingDomainRowFromDb[] | null) ?? []).map(mapRow)
}

/**
 * The active tracking domain for a workspace, or null when none is live
 * (callers fall back to the gohorace.com tracker path).
 */
export async function getActiveTrackingDomain(
  workspaceId: string,
): Promise<TrackingDomain | null> {
  const admin = createAdminClient()
  const { data } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('workspace_domains' as any)
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .maybeSingle()

  return data ? mapRow(data as TrackingDomainRowFromDb) : null
}
