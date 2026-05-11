import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

type AdminClient = SupabaseClient<Database>

/**
 * Form-factor + browser engine category for identified_devices.user_agent_summary.
 *
 * Examples: desktop_chrome, mobile_safari, tablet_safari, mobile_chrome,
 *           desktop_firefox, desktop_edge, unknown.
 *
 * Mirrored in `summarize_user_agent(text)` SQL function (HOR-104 migration).
 * Keep the two in sync. If the UA string is missing or unrecognised → 'unknown'.
 */
export function summarizeUserAgent(ua: string | null | undefined): string {
  if (!ua || ua.trim().length === 0) return 'unknown'

  const u = ua.toLowerCase()

  // Form factor
  let form: 'desktop' | 'mobile' | 'tablet'
  if (/ipad|tablet/.test(u)) form = 'tablet'
  else if (/iphone|android.*mobile|mobile/.test(u)) form = 'mobile'
  else form = 'desktop'

  // Engine — order matters (edge / opera before chrome before safari)
  let engine: string
  if (/edg\//.test(u)) engine = 'edge'
  else if (/opr\/|opera/.test(u)) engine = 'opera'
  else if (/firefox/.test(u)) engine = 'firefox'
  else if (/chrome/.test(u)) engine = 'chrome'
  else if (/safari/.test(u)) engine = 'safari'
  else engine = 'other'

  return `${form}_${engine}`
}

export type IdentificationMethod =
  | 'email_link_click'
  | 'form_submit'
  | 'login'
  | 'manual_merge'

interface WriteIdentifiedDeviceArgs {
  workspaceId: string
  contactId: string
  cookieId: string // = anonymous_id from the tracker cookie
  agentId: string  // identified_by_agent_id
  method: IdentificationMethod
  userAgent?: string | null
}

/**
 * Insert or refresh an `identified_devices` row.
 *
 * - Same `(cookie_id, contact_id)` again → bumps `last_seen_at` and
 *   `cookie_expires_at`, leaves everything else alone.
 * - Same `cookie_id` but DIFFERENT `contact_id` → no-op. The brief says
 *   "log conflict, do not auto-reassign"; the legacy `identity_map`
 *   audit via `identity_stitch_history` already covers this.
 *
 * Returns true on insert-or-refresh, false on silent conflict skip.
 * Errors are logged but don't throw — identification flows shouldn't
 * fail because the device record didn't take.
 */
export async function writeIdentifiedDevice(
  supabase: AdminClient,
  args: WriteIdentifiedDeviceArgs,
): Promise<boolean> {
  const summary = summarizeUserAgent(args.userAgent)
  const now = new Date()
  const expiry = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

  // Try insert. ON CONFLICT (cookie_id) is handled by the chained UPDATE
  // when contact_id matches; otherwise we let the conflict bubble and check.
  const { error: insertError } = await supabase
    .from('identified_devices')
    .insert({
      workspace_id: args.workspaceId,
      contact_id: args.contactId,
      cookie_id: args.cookieId,
      identification_method: args.method,
      identified_by_agent_id: args.agentId,
      user_agent_summary: summary,
      first_identified_at: now.toISOString(),
      last_seen_at: now.toISOString(),
      cookie_expires_at: expiry.toISOString(),
    })

  // Happy path — fresh insert.
  if (!insertError) return true

  // Conflict — check whether it's the same contact (refresh) or different (skip).
  const isUniqueViolation =
    typeof insertError === 'object' &&
    insertError !== null &&
    'code' in insertError &&
    (insertError as { code: string }).code === '23505'

  if (!isUniqueViolation) {
    console.error('[writeIdentifiedDevice] insert error:', insertError)
    return false
  }

  const { data: existing } = await supabase
    .from('identified_devices')
    .select('contact_id')
    .eq('cookie_id', args.cookieId)
    .maybeSingle()

  if (!existing) {
    // Unique violation but row vanished — let it pass quietly.
    return false
  }

  if (existing.contact_id !== args.contactId) {
    // Different contact — conflict. Don't touch the row. The cookie
    // reassignment is already audited via identity_stitch_history in
    // both code paths (resolver + stitch_contact_from_token RPC).
    console.warn(
      `[writeIdentifiedDevice] cookie ${args.cookieId} already linked to a different contact; skipping`,
    )
    return false
  }

  // Same contact — refresh timestamps. user_agent_summary updated only
  // when previously null so we don't churn it on every visit.
  const { error: updateError } = await supabase
    .from('identified_devices')
    .update({
      last_seen_at: now.toISOString(),
      cookie_expires_at: expiry.toISOString(),
      ...(summary !== 'unknown' && { user_agent_summary: summary }),
    })
    .eq('cookie_id', args.cookieId)
    .eq('contact_id', args.contactId)

  if (updateError) {
    console.error('[writeIdentifiedDevice] refresh error:', updateError)
    return false
  }

  return true
}
