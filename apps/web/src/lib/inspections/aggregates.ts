import 'server-only'
import type { createAdminClient } from '@/lib/supabase/admin'
import { getRoles } from '@/lib/contacts/roles'

/**
 * HOR-249 — live inspection sign-in analytics.
 *
 * Computed on read from `inspection_scans` + `contacts` (no denormalised
 * columns — spec'd in the v2 handoff Q2; if this gets slow at volume,
 * HOR-263 benchmarks a denormalisation). Definitions:
 *
 *   signIns           — distinct contacts who scanned the inspection QR
 *                       (= inspection_scans rows; UNIQUE(inspection_id,
 *                       contact_id) guarantees one per contact).
 *   convertedToActive — of those, still browsing: contacts.last_seen_at
 *                       within the last 14 days. (last_seen_at is the
 *                       tracker's freshest-activity stamp — more reliable
 *                       than joining session-keyed events.)
 *   addedToPipeline   — of those, linked to a property via a metadata
 *                       role (seller/buyer attachment).
 *   wentQuiet         — signIns − convertedToActive.
 *
 * Per-scan `state` for the detail table:
 *   pipeline     — has a role attachment
 *   still-active — last_seen within 14d (and not pipeline)
 *   cold         — neither
 */

type Admin = ReturnType<typeof createAdminClient>

const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

export interface InspectionAggregate {
  signIns: number
  convertedToActive: number
  addedToPipeline: number
  wentQuiet: number
}

export type SignInState = 'pipeline' | 'still-active' | 'cold'

export interface SignInRow {
  contactId: string
  name: string
  capturedAt: string
  lastSeenAt: string | null
  state: SignInState
}

interface ScanRow {
  inspection_id: string
  contact_id: string
  captured_at: string
}
interface ContactRow {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  last_seen_at: string | null
  metadata: unknown
}

function isActive(lastSeenAt: string | null, now: number): boolean {
  if (!lastSeenAt) return false
  const t = new Date(lastSeenAt).getTime()
  return !Number.isNaN(t) && now - t <= ACTIVE_WINDOW_MS
}

function stateFor(contact: ContactRow | undefined, now: number): SignInState {
  if (!contact) return 'cold'
  if (getRoles(contact.metadata).length > 0) return 'pipeline'
  if (isActive(contact.last_seen_at, now)) return 'still-active'
  return 'cold'
}

function displayName(c: ContactRow | undefined, contactId: string): string {
  if (!c) return `Visitor · ${contactId.slice(0, 4)}`
  return (
    [c.first_name, c.last_name].filter(Boolean).join(' ') ||
    c.email ||
    `Visitor · ${contactId.slice(0, 4)}`
  )
}

async function loadScansAndContacts(admin: Admin, inspectionIds: string[]) {
  if (inspectionIds.length === 0) {
    return { scans: [] as ScanRow[], contactById: new Map<string, ContactRow>() }
  }
  const { data: scanData } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('inspection_scans' as any)
    .select('inspection_id, contact_id, captured_at')
    .in('inspection_id', inspectionIds)
  const scans = (scanData as ScanRow[] | null) ?? []

  const contactIds = Array.from(new Set(scans.map((s) => s.contact_id)))
  const contactById = new Map<string, ContactRow>()
  if (contactIds.length > 0) {
    const { data: contactData } = await admin
      .from('contacts')
      .select('id, first_name, last_name, email, last_seen_at, metadata')
      .in('id', contactIds)
    for (const c of (contactData as ContactRow[] | null) ?? []) {
      contactById.set(c.id, c)
    }
  }
  return { scans, contactById }
}

/**
 * Batch aggregates for a set of inspections (the list page: per-row chips
 * + the summary totals). Three queries total regardless of inspection
 * count: scans, contacts, then in-memory rollup.
 */
export async function aggregatesForInspections(
  admin: Admin,
  inspectionIds: string[],
): Promise<Map<string, InspectionAggregate>> {
  const { scans, contactById } = await loadScansAndContacts(admin, inspectionIds)
  const now = Date.now()
  const out = new Map<string, InspectionAggregate>()
  for (const id of inspectionIds) {
    out.set(id, { signIns: 0, convertedToActive: 0, addedToPipeline: 0, wentQuiet: 0 })
  }
  for (const s of scans) {
    const agg = out.get(s.inspection_id)
    if (!agg) continue
    agg.signIns += 1
    const state = stateFor(contactById.get(s.contact_id), now)
    if (state === 'pipeline') agg.addedToPipeline += 1
    if (state === 'pipeline' || state === 'still-active') agg.convertedToActive += 1
  }
  for (const agg of out.values()) {
    agg.wentQuiet = Math.max(0, agg.signIns - agg.convertedToActive)
  }
  return out
}

/**
 * Detailed sign-in roster for a single inspection (the past-detail page):
 * the aggregate plus the per-contact rows for the table.
 */
export async function signInDetail(
  admin: Admin,
  inspectionId: string,
): Promise<{ aggregate: InspectionAggregate; rows: SignInRow[] }> {
  const { scans, contactById } = await loadScansAndContacts(admin, [inspectionId])
  const now = Date.now()
  const rows: SignInRow[] = scans
    .map((s) => {
      const c = contactById.get(s.contact_id)
      return {
        contactId: s.contact_id,
        name: displayName(c, s.contact_id),
        capturedAt: s.captured_at,
        lastSeenAt: c?.last_seen_at ?? null,
        state: stateFor(c, now),
      }
    })
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))

  const aggregate: InspectionAggregate = {
    signIns: rows.length,
    convertedToActive: rows.filter((r) => r.state !== 'cold').length,
    addedToPipeline: rows.filter((r) => r.state === 'pipeline').length,
    wentQuiet: rows.filter((r) => r.state === 'cold').length,
  }
  return { aggregate, rows }
}
