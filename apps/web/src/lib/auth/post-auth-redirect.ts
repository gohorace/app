import type { User } from '@supabase/supabase-js'
import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * Where a freshly-authenticated (non-invite) user should land.
 *
 * Shared by the PKCE callback (`/auth/callback`) and the token_hash confirm
 * route (`/auth/confirm`) so both establish-session paths route identically:
 *
 *   • No workspace membership yet + a stashed `pending_agency_name`
 *     (first-time signup) → /onboarding, which auto-creates the workspace.
 *   • No membership and no pending name → /signup (likely a stale link from a
 *     prior, abandoned signup) so we can capture the agency name.
 *   • Otherwise → the requested redirect target.
 */
export async function destinationForUser(
  admin: ReturnType<typeof createAdminClient>,
  user: User,
  redirectTo: string,
): Promise<string> {
  const { data: membership } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    const pendingAgencyName = (user.user_metadata as Record<string, unknown> | null)
      ?.pending_agency_name
    if (typeof pendingAgencyName === 'string' && pendingAgencyName.length > 0) {
      return '/onboarding'
    }
    return '/signup'
  }

  return redirectTo
}

/** Only allow same-origin paths to prevent open redirects. */
export function isSafeRedirect(target: string): boolean {
  return target.startsWith('/') && !target.startsWith('//')
}
