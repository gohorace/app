import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

/**
 * HOR-201 — Invite-specific magic-link callback.
 *
 *   GET /auth/callback/invite/{inviteId}?code=…
 *
 * The accept-CTA points the magic link's `emailRedirectTo` at this path-based
 * URL so the invite_id survives the Supabase verify → redirect round-trip even
 * when query params would be stripped (e.g. a Redirect URLs allowlist without
 * wildcards, mail scanners, link wrappers).
 *
 * The legacy query-param branch in /auth/callback is kept for backwards
 * compatibility with any in-flight emails and will be pruned in a follow-up.
 *
 * Flow mirrors /auth/callback's invite branch exactly:
 *   1. Exchange the code for a session (creates the auth.users row if needed).
 *   2. Call accept_workspace_invite(invite_id, user_id) — the RPC inserts
 *      workspace_members + agents rows and pre-seeds
 *      agents.last_completed_step = 'script' so the wizard resumes at
 *      'contacts' (step 3 of 4) via resumeStep().
 *   3. Redirect to /onboarding.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const inviteId = params.id?.trim()
  const url = request.nextUrl
  const code = url.searchParams.get('code')
  const errorCode = url.searchParams.get('error') ?? url.searchParams.get('error_code')
  const errorDescription = url.searchParams.get('error_description')

  if (errorCode || errorDescription) {
    const p = new URLSearchParams()
    if (errorCode) p.set('error', errorCode)
    if (errorDescription) p.set('error_description', errorDescription)
    return NextResponse.redirect(new URL(`/login?${p.toString()}`, url.origin))
  }

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', url.origin))
  }
  if (!inviteId) {
    return NextResponse.redirect(new URL('/login?error=missing_invite_id', url.origin))
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.user) {
    console.error('[auth/callback/invite] exchange error:', error)
    return NextResponse.redirect(
      new URL(
        `/login?error=exchange_failed&error_description=${encodeURIComponent(error?.message ?? 'unknown')}`,
        url.origin,
      ),
    )
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: rpcErr } = await (admin as any).rpc('accept_workspace_invite', {
    p_invite_id: inviteId,
    p_user_id: data.user.id,
  })
  if (rpcErr) {
    // P0001 = state error (revoked / expired / already accepted / email mismatch)
    // P0002 = not found
    const message = rpcErr.message || 'unknown'
    console.error('[auth/callback/invite] accept_workspace_invite failed:', {
      inviteId,
      error: rpcErr,
    })
    const p = new URLSearchParams()
    p.set('error', 'invite_redemption_failed')
    p.set('error_description', message)
    return NextResponse.redirect(new URL(`/login?${p.toString()}`, url.origin))
  }

  return NextResponse.redirect(new URL('/onboarding', url.origin))
}
