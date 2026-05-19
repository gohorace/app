/**
 * GET  /api/settings/email-exclusions — list the agent's exclusion rules.
 * POST /api/settings/email-exclusions — add one. Server normalizes the
 *      pattern: `*@example.com` → domain rule, `foo@bar.com` → exact-email rule.
 *
 * Pattern collision: if the agent already has a domain rule that would match
 * a newly-added exact-email pattern, surface a 409 with the existing rule
 * id rather than create a redundant row.
 *
 * The agent's own email cannot be added (would self-block the composer's
 * From-address sanity check).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ADD_SCHEMA = z.object({
  pattern: z.string().min(1).max(254).trim(),
})

interface ExclusionRow {
  id: string
  pattern: string
  pattern_kind: 'email' | 'domain'
  reason: string | null
  source: 'agent' | 'seeded' | 'auto_bounce'
  created_at: string
}

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .not('workspace_id', 'is', null)
    .maybeSingle()
  if (!agent) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  }

  const { data, error } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('agent_email_exclusions' as any)
    .select('id, pattern, pattern_kind, reason, source, created_at')
    .eq('agent_id', agent.id)
    .order('source', { ascending: true })   // seeded > auto_bounce > agent
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: 'Failed to load exclusions' }, { status: 500 })
  }
  return NextResponse.json({ exclusions: (data ?? []) as ExclusionRow[] })
}

// ── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = ADD_SCHEMA.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, email')
    .eq('user_id', user.id)
    .not('workspace_id', 'is', null)
    .maybeSingle()
  if (!agent) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  }

  // ── Normalize the pattern ──────────────────────────────────────────────────
  // Accepts three input shapes:
  //   1. `*@example.com`        → domain rule
  //   2. `example.com`          → domain rule (we prepend `*@`)
  //   3. `foo@example.com`      → exact-email rule
  const raw = parsed.data.pattern.trim().toLowerCase()
  let normalized: { pattern: string; kind: 'email' | 'domain' } | null = null

  if (raw.startsWith('*@')) {
    const domain = raw.slice(2)
    if (!isLikelyDomain(domain)) {
      return NextResponse.json(
        { error: 'Domain pattern looks malformed (expected `*@example.com`).' },
        { status: 400 },
      )
    }
    normalized = { pattern: `*@${domain}`, kind: 'domain' }
  } else if (raw.includes('@')) {
    if (!isLikelyEmail(raw)) {
      return NextResponse.json(
        { error: 'Email looks malformed.' },
        { status: 400 },
      )
    }
    // Strip plus-addressing (joe+marketing@x.com → joe@x.com) so the rule
    // matches the base address. The send-side check (is_recipient_excluded)
    // does the same strip; keeping the stored form base-only avoids confusion.
    const stripped = stripPlusAddressing(raw)
    normalized = { pattern: stripped, kind: 'email' }
  } else {
    // Looks like a bare domain — treat as domain rule.
    if (!isLikelyDomain(raw)) {
      return NextResponse.json(
        {
          error:
            'Pattern must be an email (`foo@bar.com`), a domain (`bar.com`), or a wildcard (`*@bar.com`).',
        },
        { status: 400 },
      )
    }
    normalized = { pattern: `*@${raw}`, kind: 'domain' }
  }

  // ── Refuse to block the agent's own email ─────────────────────────────────
  const agentEmail = (agent as { email?: string | null }).email?.toLowerCase() ?? null
  if (
    agentEmail &&
    (normalized.pattern === agentEmail ||
      (normalized.kind === 'domain' &&
        normalized.pattern === `*@${agentEmail.split('@')[1]}`))
  ) {
    return NextResponse.json(
      {
        error:
          'You can\'t add your own address (or its domain) to the exclusion list — it would block every send.',
      },
      { status: 400 },
    )
  }

  // ── Collision check: existing domain rule covers a new email rule ─────────
  if (normalized.kind === 'email') {
    const domain = normalized.pattern.split('@')[1]
    const { data: existingDomain } = await admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('agent_email_exclusions' as any)
      .select('id, pattern')
      .eq('agent_id', agent.id)
      .eq('pattern_kind', 'domain')
      .eq('pattern', `*@${domain}`)
      .maybeSingle()
    if (existingDomain) {
      return NextResponse.json(
        {
          error: `Already covered by your domain rule \`*@${domain}\`.`,
          existing: existingDomain,
        },
        { status: 409 },
      )
    }
  }

  // ── Insert ────────────────────────────────────────────────────────────────
  const { data: row, error } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('agent_email_exclusions' as any)
    .insert({
      agent_id: agent.id,
      pattern: normalized.pattern,
      pattern_kind: normalized.kind,
      source: 'agent',
    })
    .select('id, pattern, pattern_kind, reason, source, created_at')
    .single()

  if (error) {
    // Unique constraint on (agent_id, pattern) — duplicate insert collapses
    // to a 409 with a clear message.
    if (/duplicate/i.test(error.message)) {
      return NextResponse.json(
        { error: 'That pattern is already on your exclusion list.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: 'Failed to add exclusion' }, { status: 500 })
  }

  return NextResponse.json({ exclusion: row as ExclusionRow })
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isLikelyEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

function isLikelyDomain(s: string): boolean {
  // Conservative: TLD must be ≥ 2 chars. No leading/trailing dots, no spaces.
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(s)
}

function stripPlusAddressing(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return email
  const local = email.slice(0, at)
  const domain = email.slice(at)
  const plus = local.indexOf('+')
  if (plus < 0) return email
  return `${local.slice(0, plus)}${domain}`
}
