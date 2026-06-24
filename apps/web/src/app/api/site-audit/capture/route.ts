/**
 * POST /api/site-audit/capture  — public.
 *
 * Fired from the report's email-capture block ("Send it to me"). Stores the
 * lead + findings snapshot and emails the agent the report summary. Storage is
 * best-effort (a DB blip must not cost us the user-facing success); the email
 * send is what the confirmation state reflects, so a send failure returns an
 * error the client renders in voice ("Couldn't send that — try once more?").
 *
 * Auth: none. Honeypot + soft IP rate limit guard the endpoint.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cleanDomain, isValidDomain } from '@/lib/audit/domain'
import { buildAuditReportEmail } from '@/lib/audit/email'
import type { AuditResult } from '@/lib/audit/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const IP_LIMIT_PER_MIN = 8
const ONE_MIN_MS = 60_000
const ipHits = new Map<string, number[]>()
function rateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < ONE_MIN_MS)
  hits.push(now)
  ipHits.set(ip, hits)
  return hits.length > IP_LIMIT_PER_MIN
}

interface Body {
  domain?: unknown
  email?: unknown
  result?: AuditResult
  hp?: unknown // honeypot — must stay empty
}

export async function POST(req: NextRequest) {
  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  // Honeypot: a filled hp field means a bot. Silent success, no writes/sends.
  if (typeof body.hp === 'string' && body.hp.trim() !== '') {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const domainRaw = typeof body.domain === 'string' ? body.domain : ''
  if (!EMAIL_RE.test(email) || !isValidDomain(domainRaw)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  const domain = cleanDomain(domainRaw)

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const result = body.result

  // 1) Store the lead — best-effort. Never block the response on this.
  try {
    const admin = createAdminClient()
    // `site_audit_leads` isn't in the generated database.types yet — the
    // migration applies on deploy and the types regen is deferred (same pattern
    // the public API uses). Use an untyped table handle for this insert.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from('site_audit_leads' as any) as any).insert({
      domain,
      email,
      result: result ?? null,
      ip,
      user_agent: req.headers.get('user-agent') ?? null,
    })
  } catch (err) {
    console.error('[site-audit/capture] lead insert failed:', err)
  }

  // 2) Send the report email — this is the success the UI reflects.
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[site-audit/capture] RESEND_API_KEY not set — skipping send')
    // Don't strand the user: the lead is stored, so report success and let the
    // batch follow-up catch them.
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  try {
    const { Resend } = await import('resend')
    const resend = new Resend(apiKey)
    const { subject, html, text } = buildAuditReportEmail({ domain, result })
    const { error } = await resend.emails.send({
      from: 'Horace <team@gohorace.com>',
      to: email,
      subject,
      html,
      text,
    })
    if (error) {
      console.error('[site-audit/capture] resend failed:', error)
      return NextResponse.json({ error: 'send_failed' }, { status: 502 })
    }
  } catch (err) {
    console.error('[site-audit/capture] send threw:', err)
    return NextResponse.json({ error: 'send_failed' }, { status: 502 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
