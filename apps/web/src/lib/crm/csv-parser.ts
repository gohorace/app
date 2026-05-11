import Papa from 'papaparse'
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'

/**
 * Address handling:
 *
 *   - Structured columns (Street / Suburb / State / Postcode) take precedence.
 *   - If only a single "Address" / "Street Address" column is present, the
 *     value lands in `address_raw`. The import route resolves it via
 *     `resolve_residence_property` with the raw fallback path (no structured
 *     components).
 *   - When both are present, structured wins per row; raw is dropped.
 *   - When neither is present, all address fields are null.
 *
 * Phone is normalised to E.164 via libphonenumber-js with AU as the default
 * region. Unparseable numbers fall through as the raw trimmed string, flagged
 * via `phone_unparseable` so the import summary can report it.
 *
 * Name handling: structured `First Name`/`Last Name` columns take precedence.
 * If only a single `Name` / `Full Name` column is present, the value goes in
 * `full_name_raw` and structured fields stay null — V1 brief explicitly
 * disallows guessing the split.
 */
export interface CsvContact {
  first_name: string | null
  last_name: string | null
  full_name_raw: string | null
  email: string | null
  phone: string | null
  phone_unparseable: boolean
  crm_external_id: string | null
  street: string | null
  suburb: string | null
  state: string | null
  postcode: string | null
  address_raw: string | null
}

export type FieldKey =
  | 'first_name'
  | 'last_name'
  | 'full_name'
  | 'email'
  | 'phone'
  | 'crm_external_id'
  | 'street'
  | 'suburb'
  | 'state'
  | 'postcode'
  | 'address'

// Default region for E.164 normalisation. AU = +61. Configurable per workspace
// in a later phase; today's customer base is AU-only.
const DEFAULT_PHONE_REGION: CountryCode = 'AU'

// Header aliases, case-insensitive match. Order within each list = priority.
const FIELD_MAP: Record<FieldKey, string[]> = {
  // Structured name
  first_name:      ['First Name', 'Firstname', 'First', 'Given Name'],
  last_name:       ['Last Name', 'Lastname', 'Surname', 'Family Name'],
  // Single-column full name — used only when structured first/last are absent for this row
  full_name:       ['Name', 'Full Name', 'Contact Name', 'Fullname'],
  // Identity
  email:           ['Email', 'Email Address', 'Email 1', 'Primary Email', 'E-mail'],
  phone:           ['Mobile', 'Mobile Phone', 'Cell', 'Cell Phone', 'Phone', 'Phone Number', 'Telephone'],
  // External CRM id
  crm_external_id: ['ID', 'Contact ID', 'Id', 'External ID', 'CRM ID'],
  // Structured address
  street:          ['Street', 'Street Address', 'Address Line 1', 'Address1'],
  suburb:          ['Suburb', 'City', 'Town', 'Locality'],
  state:           ['State', 'Region', 'Province'],
  postcode:        ['Postcode', 'Post Code', 'Postal Code', 'Zip', 'Zip Code'],
  // Single-column address — used only when no structured address columns exist
  address:         ['Address', 'Home Address', 'Mailing Address', 'Residence'],
}

function findColumn(headers: string[], candidates: string[]): string | null {
  for (const candidate of candidates) {
    const match = headers.find(
      (h) => h.trim().toLowerCase() === candidate.toLowerCase(),
    )
    if (match) return match
  }
  return null
}

// Per-field mapping override. `null` means "ignore this field even if auto-detected".
export type FieldMapping = Partial<Record<FieldKey, string | null>>

function autoDetectMapping(headers: string[]): Record<FieldKey, string | null> {
  return Object.fromEntries(
    (Object.keys(FIELD_MAP) as FieldKey[]).map((key) => [key, findColumn(headers, FIELD_MAP[key])]),
  ) as Record<FieldKey, string | null>
}

function applyOverrides(
  detected: Record<FieldKey, string | null>,
  overrides: FieldMapping | undefined,
  headers: string[],
): Record<FieldKey, string | null> {
  if (!overrides) return detected
  const headerSet = new Set(headers)
  const result = { ...detected }
  for (const key of Object.keys(overrides) as FieldKey[]) {
    const v = overrides[key]
    if (v === null) {
      result[key] = null
    } else if (typeof v === 'string' && headerSet.has(v)) {
      result[key] = v
    }
  }
  return result
}

function cellValue(row: Record<string, string>, col: string | null): string | null {
  if (!col) return null
  const v = row[col]?.trim()
  return v && v.length > 0 ? v : null
}

function normaliseEmail(raw: string | null): string | null {
  return raw ? raw.toLowerCase() : null
}

function normalisePhone(raw: string | null): { value: string | null; unparseable: boolean } {
  if (!raw) return { value: null, unparseable: false }
  const trimmed = raw.trim()
  if (!trimmed) return { value: null, unparseable: false }
  try {
    const parsed = parsePhoneNumberFromString(trimmed, DEFAULT_PHONE_REGION)
    if (parsed && parsed.isValid()) {
      return { value: parsed.number, unparseable: false } // E.164
    }
  } catch {
    // fall through
  }
  // Couldn't parse — surface the raw input so the agent can fix manually.
  return { value: trimmed, unparseable: true }
}

export interface ParseResult {
  contacts: CsvContact[]
  skipped: number
  skipReasons: Record<string, number>
  errors: string[]
}

export function parseCsv(csvText: string, mapping?: FieldMapping): ParseResult {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  })

  const headers = result.meta.fields ?? []
  const errors: string[] = result.errors.map((e) => e.message)

  const cols = applyOverrides(autoDetectMapping(headers), mapping, headers)

  // File-level capability flags
  const hasStructuredName = cols.first_name !== null || cols.last_name !== null
  const hasFullName = cols.full_name !== null
  const hasStructuredAddress =
    cols.street !== null || cols.suburb !== null || cols.state !== null || cols.postcode !== null
  const hasSingleAddress = cols.address !== null

  const contacts: CsvContact[] = []
  let skipped = 0
  const skipReasons: Record<string, number> = {}
  const noteSkip = (reason: string) => {
    skipped++
    skipReasons[reason] = (skipReasons[reason] ?? 0) + 1
  }

  for (const row of result.data) {
    const email = normaliseEmail(cellValue(row, cols.email))
    const { value: phone, unparseable: phoneUnparseable } = normalisePhone(
      cellValue(row, cols.phone),
    )

    // V1 brief: contacts need at least an email OR a phone. Reject otherwise.
    if (!email && !phone) {
      noteSkip('missing_email_and_phone')
      continue
    }

    // Name fields. Structured wins per row; fall back to full_name_raw only
    // when both structured fields are empty for this row.
    let first_name: string | null = null
    let last_name: string | null = null
    let full_name_raw: string | null = null

    if (hasStructuredName) {
      first_name = cellValue(row, cols.first_name)
      last_name = cellValue(row, cols.last_name)
    }

    if (!first_name && !last_name && hasFullName) {
      // Brief is explicit: don't guess splits, leave first/last null,
      // populate full_name_raw.
      full_name_raw = cellValue(row, cols.full_name)
    }

    // Address fields. Structured first, then single-line fallback.
    let street: string | null = null
    let suburb: string | null = null
    let state: string | null = null
    let postcode: string | null = null
    let address_raw: string | null = null

    if (hasStructuredAddress) {
      street = cellValue(row, cols.street)
      suburb = cellValue(row, cols.suburb)
      state = cellValue(row, cols.state)
      postcode = cellValue(row, cols.postcode)
    }

    const hasAnyStructuredAddress =
      street !== null || suburb !== null || state !== null || postcode !== null

    if (!hasAnyStructuredAddress && hasSingleAddress) {
      address_raw = cellValue(row, cols.address)
    }

    contacts.push({
      first_name,
      last_name,
      full_name_raw,
      email,
      phone,
      phone_unparseable: phoneUnparseable,
      crm_external_id: cellValue(row, cols.crm_external_id),
      street,
      suburb,
      state,
      postcode,
      address_raw,
    })
  }

  return { contacts, skipped, skipReasons, errors }
}

// ── Preview helpers (for the upload → confirm step) ──────────────────────────

export interface CsvPreview {
  headers: string[]
  detected: Record<FieldKey, string | null>
  rowCount: number
  sampleRows: Record<string, string>[]
  errors: string[]
}

export function previewCsv(csvText: string, sampleSize = 5): CsvPreview {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    preview: sampleSize + 1,
  })
  const headers = result.meta.fields ?? []

  // The preview parse stops early; count non-empty data lines for total size.
  const allLines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const rowCount = Math.max(0, allLines.length - 1)

  return {
    headers,
    detected: autoDetectMapping(headers),
    rowCount,
    sampleRows: result.data.slice(0, sampleSize),
    errors: result.errors.map((e) => e.message),
  }
}

export const FIELD_LABELS: Record<FieldKey, string> = {
  first_name:      'First name',
  last_name:       'Last name',
  full_name:       'Full name (single column)',
  email:           'Email',
  phone:           'Phone',
  crm_external_id: 'External ID',
  street:          'Street',
  suburb:          'Suburb',
  state:           'State',
  postcode:        'Postcode',
  address:         'Address (single column)',
}
