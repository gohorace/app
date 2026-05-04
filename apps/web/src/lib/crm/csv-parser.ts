import Papa from 'papaparse'

export interface CsvContact {
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  crm_external_id: string | null
}

// Flexible column name matching — works with exports from any CRM
const FIELD_MAP: Record<keyof CsvContact, string[]> = {
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

export interface ParseResult {
  contacts: CsvContact[]
  skipped: number
  errors: string[]
}

export function parseCsv(csvText: string): ParseResult {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  })

  const headers = result.meta.fields ?? []
  const errors: string[] = result.errors.map((e) => e.message)

  // Resolve which CSV column maps to each field
  const colMap = Object.fromEntries(
    Object.entries(FIELD_MAP).map(([field, candidates]) => [
      field,
      findColumn(headers, candidates),
    ]),
  ) as Record<keyof CsvContact, string | null>

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
