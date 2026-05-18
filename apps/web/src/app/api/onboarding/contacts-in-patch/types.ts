/**
 * Shared types for /api/onboarding/contacts-in-patch.
 *
 * Lives in a sibling module because Next.js 14 disallows non-route
 * exports from route.ts (same constraint as site-probe/validate.ts).
 */

export interface ContactsInPatchResponse {
  /** Every non-deleted contact in the agent's workspace. */
  total: number
  /** Subset whose suburb matches one of the agent's active core_markets
   *  localities, case-insensitive. */
  in_patch: number
}
