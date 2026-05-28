/**
 * HOR-322 · "Take your data anywhere" — one-click export (admin-only).
 *
 * Sovereignty surface: the whole agency dataset (contacts + properties +
 * relationships), in the SAME public shape the API returns — so what you export
 * is exactly what you'd get over the wire. No request, no wait.
 *
 *   ?format=json                         → one file, all three resources
 *   ?format=csv&resource=contacts        → one CSV per resource
 *                       |properties
 *                       |relationships
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createApiV1Db } from '@/lib/api-v1/db'
import { resolveAdminContext } from '@/lib/api-v1/admin-guard'
import {
  mapContact,
  mapProperty,
  mapRelationship,
  type ContactRow,
  type PropertyRow,
  type EngagementRow,
} from '@/lib/api-v1/mappers'

export const dynamic = 'force-dynamic'

const CONTACT_COLUMNS =
  'id, email, phone, first_name, last_name, source, ingestion_method, external_ids, created_at, updated_at'
const PROPERTY_COLUMNS =
  'id, gnaf_address_detail_pid, street_number, street_name, suburb, state, postcode, created_at'
const ENGAGEMENT_COLUMNS =
  'id, contact_id, property_id, type, first_engaged_at, last_engaged_at, engagement_count'

function csvEscape(value: unknown): string {
  if (value == null) return ''
  const s = typeof value === 'string' ? value : JSON.stringify(value)
  return `"${s.replace(/"/g, '""')}"`
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const head = headers.join(',')
  const lines = rows.map((r) => headers.map((h) => csvEscape(r[h])).join(','))
  return [head, ...lines].join('\n') + '\n'
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createApiV1Db()
  const ctx = await resolveAdminContext(db, user.id)
  if (!ctx) return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  if (!ctx.isAdmin) {
    // Export bundles the whole agency dataset → admin-only.
    return NextResponse.json(
      { error: 'Exporting the agency dataset is admin-only.' },
      { status: 403 },
    )
  }

  const ws = ctx.workspaceId
  const format = req.nextUrl.searchParams.get('format') ?? 'json'
  const resource = req.nextUrl.searchParams.get('resource') ?? 'contacts'
  const today = new Date().toISOString().slice(0, 10)

  const fetchContacts = async () => {
    const { data } = await db
      .from('contacts')
      .select(CONTACT_COLUMNS)
      .eq('workspace_id', ws)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
    return ((data as ContactRow[] | null) ?? []).map(mapContact)
  }
  const fetchProperties = async () => {
    const { data } = await db
      .from('properties')
      .select(PROPERTY_COLUMNS)
      .eq('workspace_id', ws)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
    return ((data as PropertyRow[] | null) ?? []).map(mapProperty)
  }
  const fetchRelationships = async () => {
    const { data } = await db
      .from('contact_property_engagement')
      .select(ENGAGEMENT_COLUMNS)
      .eq('workspace_id', ws)
      .order('last_engaged_at', { ascending: true })
    return ((data as EngagementRow[] | null) ?? []).map(mapRelationship)
  }

  if (format === 'json') {
    const [contacts, properties, relationships] = await Promise.all([
      fetchContacts(),
      fetchProperties(),
      fetchRelationships(),
    ])
    const body = JSON.stringify(
      { exported_at: new Date().toISOString(), contacts, properties, relationships },
      null,
      2,
    )
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="horace-export-${today}.json"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  if (format === 'csv') {
    let csv: string
    if (resource === 'properties') {
      const rows = (await fetchProperties()).map((p) => ({
        id: p.id,
        gnaf_id: p.gnaf_id,
        address: p.address.full,
        street: p.address.street,
        suburb: p.address.suburb,
        state: p.address.state,
        postcode: p.address.postcode,
        created_at: p.created_at,
      }))
      csv = toCsv(
        ['id', 'gnaf_id', 'address', 'street', 'suburb', 'state', 'postcode', 'created_at'],
        rows,
      )
    } else if (resource === 'relationships') {
      const rows = await fetchRelationships()
      csv = toCsv(
        [
          'id',
          'contact_id',
          'property_id',
          'type',
          'first_engaged_at',
          'last_engaged_at',
          'engagement_count',
        ],
        rows as unknown as Array<Record<string, unknown>>,
      )
    } else {
      const rows = (await fetchContacts()).map((c) => ({
        id: c.id,
        email: c.email,
        phone: c.phone,
        first_name: c.first_name,
        last_name: c.last_name,
        source: c.source,
        external_ids: c.external_ids,
        created_at: c.created_at,
        updated_at: c.updated_at,
      }))
      csv = toCsv(
        [
          'id',
          'email',
          'phone',
          'first_name',
          'last_name',
          'source',
          'external_ids',
          'created_at',
          'updated_at',
        ],
        rows,
      )
    }
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="horace-${resource}-${today}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  return NextResponse.json({ error: 'format must be json or csv.' }, { status: 400 })
}
