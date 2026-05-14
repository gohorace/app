/**
 * Doorstep phone normalisation.
 *
 * The public capture form (HOR-151) collects a mobile number with no
 * SMS verification — friction kills the loop. The capture endpoint
 * (HOR-152) normalises to E.164 here before calling
 * `stitch_contact_from_inspection`, which trusts the result.
 *
 * Mirrors the CSV importer's `normalisePhone` (lib/crm/csv-parser.ts)
 * but exposes a cleaner two-field shape — `{ e164, isValid }` — so the
 * API layer can branch on validity directly without inferring it from
 * a sentinel value. AU is the default region; later workspaces with
 * non-AU phone bases will need a per-workspace setting (deferred).
 */

import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'

const DEFAULT_REGION: CountryCode = 'AU'

export interface NormalisedPhone {
  /** E.164 form (e.g. `+61412345678`) when parseable and valid; otherwise null. */
  e164: string | null
  /** True iff the input parsed AND libphonenumber considered it a valid number. */
  isValid: boolean
}

/**
 * Normalise raw user input to E.164.
 *
 * - `null` / `undefined` / blank → `{ e164: null, isValid: false }`
 * - Parseable + valid → `{ e164: '<E.164>', isValid: true }`
 * - Anything else → `{ e164: null, isValid: false }` (caller surfaces a 400)
 *
 * Region defaults to AU (the only market in v1). Callers can override
 * per workspace once that wiring exists.
 */
export function toE164(
  input: string | null | undefined,
  region: CountryCode = DEFAULT_REGION,
): NormalisedPhone {
  if (!input) return { e164: null, isValid: false }
  const trimmed = input.trim()
  if (trimmed.length === 0) return { e164: null, isValid: false }

  try {
    const parsed = parsePhoneNumberFromString(trimmed, region)
    if (parsed && parsed.isValid()) {
      return { e164: parsed.number, isValid: true }
    }
  } catch {
    // libphonenumber-js throws on truly malformed input — fall through.
  }
  return { e164: null, isValid: false }
}
