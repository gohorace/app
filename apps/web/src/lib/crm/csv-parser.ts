import Papa from 'papaparse'

export interface CsvContact {
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  crm_external_id: string | null
}

export type FieldKey = keyof CsvContact

// Flexible column name matching — works with exports from any CRM
const FIELD_MAP: Record<FieldKey, string[]> = {
  first_name:       ['First Name', 'Firstname', 'First', 'Given Name'],
  last_name:        ['Last Name', 'Lastname', 'Surname', 'Family Name'],
  email:            ['Email', 'Email Address', 'Email 1', 'Primary Email'],
  phone:            ['Mobile', 'Mobile Phone', 'Cell', 'Cell Phone', 'Phone', 'Phone Number'],
  crm_external_id:  ['ID', 'Contact ID', 'Id', 'External ID', 'CRM ID'],
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
  return {
    first_name:      findColumn(headers, FIELD_MAP.first_name),
    last_name:       findColumn(headers, FIELD_MAP.last_name),
    email:           findColumn(headers, FIELD_MAP.email),
    phone:           findColumn(headers, FIELD_MAP.phone),
    crm_external_id: findColumn(headers, FIELD_MAP.crm_external_id),
  }
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

export interface ParseResult {
  contacts: CsvContact[]
  skipped: number
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

  const colMap = applyOverrides(autoDetectMapping(headers), mapping, headers)

  let skipped = 0
  const contacts: CsvContact[] = []

  for (const row of result.data) {
    const email = colMap.email ? row[colMap.email]?.trim() || null : null
    const firstName = colMap.first_name ? row[colMap.first_name]?.trim() || null : null
    const lastName = colMap.last_name ? row[colMap.last_name]?.trim() || null : null

    // Skip rows with no identifying info
    if (!email && !firstName && !lastName) {
      skipped++
      continue
    }

    contacts.push({
      email: email?.toLowerCase() ?? null,
      first_name: firstName,
      last_name: lastName,
      phone: colMap.phone ? row[colMap.phone]?.trim() || null : null,
      crm_external_id: colMap.crm_external_id
        ? row[colMap.crm_external_id]?.trim() || null
        : null,
    })
  }

  return { contacts, skipped, errors }
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
  email:           'Email',
  phone:           'Phone',
  crm_external_id: 'External ID',
}
