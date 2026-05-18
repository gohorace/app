/**
 * HOR-204 — POST /api/domains
 *
 * Register a custom domain for the caller's workspace. Owner/admin only.
 *
 * Body: { hostname: string }
 *
 * Flow:
 *   1. Validate hostname (RFC 1123 subset).
 *   2. Insert a `pending` row in `workspace_custom_domains`.
 *   3. Call Vercel's `addDomain` to register it against the project.
 *   4. Persist the verification records + vercel_domain_id.
 *   5. Return the CNAME target + verification records so the UI can
 *      render the DNS instructions.
 *
 * Idempotent on re-add of an already-registered hostname under the
 * same workspace — returns the existing row. Refuses cross-workspace
 * hostname conflicts at the unique-index level.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  addDomain,
  isValidHostname,
  VercelDomainError,
  type VercelVerificationRecord,
} from '@/lib/vercel/domains'
import { invalidateHostLookup } from '@/lib/domains/lookup'

const bodySchema = z.object({
  hostname: z.string().min(1).max(253),
})

interface CustomDomainRow {
  id: string
  workspace_id: string
  hostname: string
  status: string
  ssl_status: string
  dns_target: string
  verification_records: VercelVerificationRecord[] | null
  vercel_domain_id: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let parsed
  try {
    parsed = bodySchema.safeParse(await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const hostname = parsed.data.hostname.trim().toLowerCase()
  if (!isValidHostname(hostname)) {
    return NextResponse.json(
      { error: 'Enter a valid hostname like inspections.agentname.com.au' },
      { status: 400 },
    )
  }

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user.id)
    .not('workspace_id', 'is', null)
    .maybeSingle()
  if (!agent?.workspace_id) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  }

  // ACL: owner or admin.
  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', agent.workspace_id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Look for an existing row for this workspace + hostname.
  // - status in (pending | verifying | verified) → stable, return as-is.
  // - status = 'failed' → a previous attempt errored before/during Vercel
  //   registration. Reset to 'pending' and re-attempt registration on
  //   this same row (don't insert a duplicate).
  // - no row → INSERT a fresh one.
  const { data: existingRaw } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('workspace_custom_domains' as any)
    .select('*')
    .eq('workspace_id', agent.workspace_id)
    .eq('hostname', hostname)
    .neq('status', 'removed')
    .maybeSingle()
  const existing = existingRaw as CustomDomainRow | null

  // Stable states are idempotent — return the existing row.
  if (existing && existing.status !== 'failed') {
    return NextResponse.json({
      id: existing.id,
      hostname: existing.hostname,
      status: existing.status,
      ssl_status: existing.ssl_status,
      dns_target: existing.dns_target,
      verification_records: existing.verification_records,
      already: true,
    })
  }

  let row: CustomDomainRow

  if (existing) {
    // Failed row: reset and re-use the same id.
    const { data: resetRaw, error: resetErr } = await admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('workspace_custom_domains' as any)
      .update({
        status: 'pending',
        ssl_status: 'pending',
        error_message: null,
        last_checked_at: null,
        verification_records: null,
      })
      .eq('id', existing.id)
      .select('*')
      .single()
    if (resetErr || !resetRaw) {
      console.error('Failed to reset failed workspace_custom_domain', resetErr)
      return NextResponse.json({ error: 'Failed to retry domain' }, { status: 500 })
    }
    row = resetRaw as CustomDomainRow
  } else {
    // INSERT first so a Vercel failure doesn't orphan the row. The
    // unique index on lower(hostname) catches cross-workspace conflicts here.
    const { data: insertedRaw, error: insertErr } = await admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('workspace_custom_domains' as any)
      .insert({
        workspace_id: agent.workspace_id,
        hostname,
        status: 'pending',
        ssl_status: 'pending',
        dns_target: 'cname.vercel-dns.com',
      })
      .select('*')
      .single()
    if (insertErr || !insertedRaw) {
      if (insertErr?.code === '23505') {
        return NextResponse.json(
          { error: 'That hostname is already in use by another workspace.' },
          { status: 409 },
        )
      }
      console.error('Failed to insert workspace_custom_domain', {
        code: insertErr?.code,
        message: insertErr?.message,
        details: insertErr?.details,
        hint: insertErr?.hint,
      })
      return NextResponse.json(
        {
          error: 'Failed to create domain',
          detail: insertErr?.message ?? null,
          code: insertErr?.code ?? null,
        },
        { status: 500 },
      )
    }
    row = insertedRaw as CustomDomainRow
  }

  // Register with Vercel.
  try {
    const result = await addDomain(hostname)
    await admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('workspace_custom_domains' as any)
      .update({
        status: result.verified ? 'verified' : 'verifying',
        ssl_status: result.verified ? 'provisioning' : 'pending',
        // Stamp `vercel_domain_id` so the verify route knows the domain
        // reached Vercel. We use hostname itself as the id — Vercel's
        // endpoints key off the hostname, not a separate id.
        vercel_domain_id: hostname,
        verification_records: result.verificationRecords,
        last_checked_at: new Date().toISOString(),
        verified_at: result.verified ? new Date().toISOString() : null,
        error_message: null,
      })
      .eq('id', row.id)

    invalidateHostLookup(hostname)

    return NextResponse.json({
      id: row.id,
      hostname,
      status: result.verified ? 'verified' : 'verifying',
      ssl_status: result.verified ? 'provisioning' : 'pending',
      dns_target: 'cname.vercel-dns.com',
      verification_records: result.verificationRecords,
    })
  } catch (err) {
    const message = err instanceof VercelDomainError ? err.message : 'Vercel call failed'
    await admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('workspace_custom_domains' as any)
      .update({
        status: 'failed',
        error_message: message,
        last_checked_at: new Date().toISOString(),
      })
      .eq('id', row.id)
    console.error('Vercel addDomain failed', { hostname, err })
    return NextResponse.json(
      { error: message, id: row.id, status: 'failed' },
      { status: 502 },
    )
  }
}
