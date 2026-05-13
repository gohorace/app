import type { IdentityState } from '@/lib/design/badges'

/**
 * Derive the four-tier identity state from contact fields. Mirrors the
 * design's anonymous → email → partial → known progression.
 *
 *  - **known**     — has first/last + (email or phone). The agent has the
 *                    full identity in their book.
 *  - **partial**   — has first/last name only. Identified but missing reach.
 *  - **email**     — has email or phone but no name. Contactable but anon-named.
 *  - **anonymous** — no identifiers at all. Tracked by device/session only.
 *
 * Callers can override the rule with explicit metadata.identity if a future
 * slice introduces an explicit identity state (e.g. CRM sync overrides).
 */
export function deriveIdentity(input: {
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone?: string | null
}): IdentityState {
  const hasName  = Boolean(input.first_name || input.last_name)
  const hasReach = Boolean(input.email || input.phone)

  if (hasName && hasReach) return 'known'
  if (hasName)             return 'partial'
  if (hasReach)            return 'email'
  return 'anonymous'
}

/**
 * Initials for an avatar. Falls back to email's first letter, then `?`.
 * Always uppercases.
 */
export function makeInitials(input: {
  first_name?: string | null
  last_name?: string | null
  email?: string | null
}): string {
  const fromName = [input.first_name?.[0], input.last_name?.[0]]
    .filter(Boolean)
    .join('')
    .toUpperCase()
  if (fromName) return fromName
  if (input.email) return input.email[0]?.toUpperCase() ?? '?'
  return '?'
}
