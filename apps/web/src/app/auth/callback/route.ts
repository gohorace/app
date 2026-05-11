import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

function isSafeRedirect(target: string): boolean {
  // Only allow same-origin paths to prevent open redirects.
  return target.startsWith('/') && !target.startsWith('//')
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const code = url.searchParams.get('code')
  const errorCode = url.searchParams.get('error') ?? url.searchParams.get('error_code')
  const errorDescription = url.searchParams.get('error_description')
  const requestedRedirect = url.searchParams.get('redirectTo') ?? '/dashboard'
  const redirectTo = isSafeRedirect(requestedRedirect) ? requestedRedirect : '/dashboard'
  const inviteId = url.searchParams.get('invite_id')

  if (errorCode || errorDescription) {
    const params = new URLSearchParams()
    if (errorCode) params.set('error', errorCode)
    if (errorDescription) params.set('error_description', errorDescription)
    return NextResponse.redirect(new URL(`/login?${params.toString()}`, url.origin))
  }

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', url.origin))
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.user) {
    console.error('[auth/callback] exchange error:', error)
    return NextResponse.redirect(
      new URL(`/login?error=exchange_failed&error_description=${encodeURIComponent(error?.message ?? 'unknown')}`, url.origin),
    )
  }

  const admin = createAdminClient()

  // HOR-100: invite redemption branch. If `invite_id` is present, redeem via
  // the accept_workspace_invite RPC. On success, the user is now a member —
  // fall through to the membership check below which will route to /dashboard.
  if (inviteId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: rpcErr } = await (admin as any).rpc('accept_workspace_invite', {
      p_invite_id: inviteId,
      p_user_id: data.user.id,
    })
    if (rpcErr) {
      // Distinguish state-error from not-found by SQLSTATE if available.
      // P0001 = state error (revoked / expired / already accepted / email mismatch)
      // P0002 = not found
      const message = rpcErr.message || 'unknown'
      console.error('[auth/callback] accept_workspace_invite failed:', { inviteId, error: rpcErr })
      const params = new URLSearchParams()
      params.set('error', 'invite_redemption_failed')
      params.set('error_description', message)
      return NextResponse.redirect(new URL(`/login?${params.toString()}`, url.origin))
    }
    // Acceptance succeeded — workspace_members and agents rows are now in place.
    // Fall through to the membership check; it should hit the "has membership"
    // branch and redirect to /dashboard.
  }

  // First-time post-signup: stash the agency name in user_metadata at signup time.
  // If we have it and the user has no workspace yet, route through /onboarding so
  // it can auto-create the workspace before showing the snippet step.
  const { data: membership } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', data.user.id)
    .maybeSingle()

  if (!membership) {
    const pendingAgencyName = (data.user.user_metadata as Record<string, unknown> | null)?.pending_agency_name
    if (typeof pendingAgencyName === 'string' && pendingAgencyName.length > 0) {
      return NextResponse.redirect(new URL('/onboarding', url.origin))
    }
    // No workspace and no pending name — likely a stale magic link from a prior
    // signup attempt. Send them back to /signup to capture the agency name.
    return NextResponse.redirect(new URL('/signup', url.origin))
  }

  return NextResponse.redirect(new URL(redirectTo, url.origin))
}
