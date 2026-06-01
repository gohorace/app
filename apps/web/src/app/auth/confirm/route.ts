import { NextRequest, NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { destinationForUser, isSafeRedirect } from '@/lib/auth/post-auth-redirect'

export const runtime = 'nodejs'

/**
 * GET /auth/confirm — browser-independent magic-link verification.
 *
 * The auth email (built in `app/api/auth/send-email/route.ts`) points here
 * with the `token_hash` + `type` rather than at Supabase's PKCE `/auth/v1/verify`
 * → `?code=` round-trip. `verifyOtp` validates the token_hash server-side and
 * needs NO locally-stored code_verifier, so it works even when the link is
 * opened in a different browser than the one that requested it — e.g. tapping
 * the link from the Gmail app's in-app browser on iOS. That cross-browser case
 * is exactly what made the PKCE `/auth/callback` fail with
 * "both auth code and code verifier should be non-empty".
 *
 * Routing after a verified session mirrors `/auth/callback`:
 *   • invite_id present → accept_workspace_invite RPC, then /onboarding.
 *   • otherwise → destinationForUser (onboarding / signup / requested target).
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const tokenHash = url.searchParams.get('token_hash')
  const type = (url.searchParams.get('type') ?? 'magiclink') as EmailOtpType
  const inviteId = url.searchParams.get('invite_id')
  const requestedRedirect = url.searchParams.get('redirectTo') ?? '/dashboard'
  const redirectTo = isSafeRedirect(requestedRedirect) ? requestedRedirect : '/dashboard'

  if (!tokenHash) {
    return NextResponse.redirect(new URL('/login?error=missing_token', url.origin))
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
  if (error || !data.user) {
    console.error('[auth/confirm] verifyOtp error:', error)
    return NextResponse.redirect(
      new URL(
        `/login?error=verify_failed&error_description=${encodeURIComponent(error?.message ?? 'unknown')}`,
        url.origin,
      ),
    )
  }

  const admin = createAdminClient()

  // Invite redemption — mirrors /auth/callback's invite branch.
  if (inviteId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: rpcErr } = await (admin as any).rpc('accept_workspace_invite', {
      p_invite_id: inviteId,
      p_user_id: data.user.id,
    })
    if (rpcErr) {
      console.error('[auth/confirm] accept_workspace_invite failed:', { inviteId, error: rpcErr })
      const params = new URLSearchParams()
      params.set('error', 'invite_redemption_failed')
      params.set('error_description', rpcErr.message || 'unknown')
      return NextResponse.redirect(new URL(`/login?${params.toString()}`, url.origin))
    }
    return NextResponse.redirect(new URL('/onboarding', url.origin))
  }

  const destination = await destinationForUser(admin, data.user, redirectTo)
  return NextResponse.redirect(new URL(destination, url.origin))
}
