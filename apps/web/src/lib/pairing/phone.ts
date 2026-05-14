/**
 * HOR-162 — AU mobile validation for the pairing SMS endpoint.
 *
 * Lives outside the route handler because Next.js App Router only
 * allows HTTP method exports (and a small set of runtime config)
 * from a `route.ts` file. Pulling the pure function into the lib
 * also makes it trivially unit-testable in isolation.
 */

import { parsePhoneNumberFromString } from 'libphonenumber-js'

/**
 * Parse + validate an AU mobile. Returns the E.164 form on success
 * or null on rejection (invalid shape, wrong country, landline).
 *
 * Accepts national format (`0412 345 678`), international format
 * (`+61 412 345 678`), and the common punctuation variants
 * libphonenumber-js tolerates. Rejects landlines (state codes
 * 02/03/07/08), non-AU numbers (even in international format),
 * and obvious junk.
 */
export function normalizeAuMobile(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input, 'AU')
  if (!parsed || !parsed.isValid()) return null
  // AU mobile prefixes resolve as either MOBILE or
  // FIXED_LINE_OR_MOBILE in libphonenumber metadata. Both are
  // accepted; landlines and other types are rejected.
  const type = parsed.getType()
  if (type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE') return null
  // Default-country 'AU' would otherwise let an explicit
  // international non-AU number through. Belt-and-braces.
  if (parsed.country !== 'AU') return null
  return parsed.number
}
