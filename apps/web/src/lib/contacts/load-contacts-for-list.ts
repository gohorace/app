import 'server-only'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { ContactGridRow, SavedFilterState } from '@/components/contacts/contacts-grid'
import { getRoles } from '@/lib/contacts/roles'
import { findBuiltin, isBuiltinSlug } from '@/lib/lists/builtin'

/**
 * Shared server loader for the Contacts grid, scoped to an optional list.
 *
 * Extracted from `app/(dashboard)/contacts/page.tsx` (HOR-248) so the new
 * `/lists/[id]` detail route can render the same rich grid without
 * duplicating the three-read load (RPC base rows → metadata/roles →
 * referenced properties) + the manual-membership / built-in-score scoping.
 *
 * Pass exactly one of `listId` (a `lists.id` uuid) or `builtinSlug`
 * (`watch-closely` | `warming-up`) — or neither for the unscoped book.
 */

type Admin = ReturnType<typeof createAdminClient>

export type SelectedList = {
  id: string
  name: string
  kind: 'manual' | 'saved_filter' | 'builtin'
  filter_state: SavedFilterState | null
}

export interface LoadContactsResult {
  contacts: ContactGridRow[]
  selectedList: SelectedList | null
  defaultLinkUrl: string | null
  appUrl: string
}

interface BaseRow {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  score: number
  score_change_7d: number
  last_seen_at: string | null
  suburb: string | null
  source: string
  is_stitched: boolean
  residence_property_id: string | null
  tracked_link_token: string | null
  tracked_link_destination_url: string | null
  tracked_link_last_clicked_at: string | null
}

export async function loadContactsForList(
  admin: Admin,
  opts: {
    agentId: string
    workspaceId: string | null
    listId?: string | null
    builtinSlug?: string | null
  },
): Promise<LoadContactsResult> {
  const { agentId, workspaceId } = opts
  const listId = opts.listId?.trim() || null
  const builtinSlug = opts.builtinSlug?.trim() || null

  let selectedList: SelectedList | null = null
  let manualListMemberIds: Set<string> | null = null
  let builtinScoreRange: { min: number; maxExclusive: number | null } | null = null

  if (listId && workspaceId) {
    const { data: row } = await admin
      .from('lists')
      .select('id, name, kind, filter_state')
      .eq('id', listId)
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .maybeSingle()
    if (row) {
      selectedList = {
        id: row.id,
        name: row.name,
        kind: row.kind as 'manual' | 'saved_filter',
        filter_state: (row.filter_state as SavedFilterState | null) ?? null,
      }
      if (selectedList.kind === 'manual') {
        const { data: memberRows } = await admin
          .from('contact_list_membership')
          .select('contact_id')
          .eq('list_id', row.id)
        manualListMemberIds = new Set((memberRows ?? []).map((m) => m.contact_id))
      }
    }
  } else if (builtinSlug && isBuiltinSlug(builtinSlug)) {
    const def = findBuiltin(builtinSlug)!
    selectedList = { id: def.slug, name: def.name, kind: 'builtin', filter_state: null }
    builtinScoreRange = { min: def.minScore, maxExclusive: def.maxScoreExclusive }
  }

  const { data: settings } = await admin
    .from('agent_settings')
    .select('website_url')
    .eq('agent_id', agentId)
    .maybeSingle()
  const defaultLinkUrl = settings?.website_url ?? null
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.gohorace.com'

  // 1 — base list via RPC, fallback to plain contacts select.
  let baseRows: BaseRow[] = []
  const { data: richData, error: richErr } = await admin.rpc('get_contacts_list', {
    p_agent_id: agentId,
  })

  if (!richErr && Array.isArray(richData)) {
    baseRows = richData.map((r) => ({
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      email: r.email,
      phone: r.phone,
      score: r.score,
      score_change_7d: r.score_change_7d,
      last_seen_at: r.last_seen_at,
      suburb: r.suburb,
      source: r.source,
      is_stitched: r.is_stitched,
      residence_property_id: null,
      tracked_link_token: r.tracked_link_token,
      tracked_link_destination_url: r.tracked_link_destination_url,
      tracked_link_last_clicked_at: r.tracked_link_last_clicked_at,
    }))
  } else {
    const { data: fallback } = await admin
      .from('contacts')
      .select('id, first_name, last_name, email, phone, score, last_seen_at, suburb, source, residence_property_id')
      .eq('agent_id', agentId)
      .is('deleted_at', null)
      .order('score', { ascending: false })
      .limit(500)
    baseRows = (fallback ?? []).map((c) => ({
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      phone: c.phone,
      score: c.score,
      score_change_7d: 0,
      last_seen_at: c.last_seen_at,
      suburb: c.suburb,
      source: c.source,
      is_stitched: false,
      residence_property_id: c.residence_property_id,
      tracked_link_token: null,
      tracked_link_destination_url: null,
      tracked_link_last_clicked_at: null,
    }))
  }

  // Scope BEFORE the metadata + properties batch so those stay tight.
  if (manualListMemberIds) {
    baseRows = baseRows.filter((r) => manualListMemberIds!.has(r.id))
  }
  if (builtinScoreRange) {
    const { min, maxExclusive } = builtinScoreRange
    baseRows = baseRows.filter((r) => {
      if (r.score < min) return false
      if (maxExclusive !== null && r.score >= maxExclusive) return false
      return true
    })
  }

  if (baseRows.length === 0) {
    return { contacts: [], selectedList, defaultLinkUrl, appUrl }
  }

  // 2 — metadata + residence_property_id for the same contacts.
  const ids = baseRows.map((r) => r.id)
  const { data: metaRows } = await admin
    .from('contacts')
    .select('id, metadata, residence_property_id')
    .in('id', ids)
  const metaById = new Map<string, { metadata: unknown; residence_property_id: string | null }>(
    (metaRows ?? []).map((m) => [m.id, { metadata: m.metadata, residence_property_id: m.residence_property_id }]),
  )

  const rolesByContact = new Map<string, ReturnType<typeof getRoles>>()
  const propertyIdSet = new Set<string>()
  for (const r of baseRows) {
    const meta = metaById.get(r.id)
    if (meta) {
      r.residence_property_id = meta.residence_property_id
      if (meta.residence_property_id) propertyIdSet.add(meta.residence_property_id)
      const roles = getRoles(meta.metadata)
      rolesByContact.set(r.id, roles)
      for (const role of roles) propertyIdSet.add(role.property_id)
    } else {
      rolesByContact.set(r.id, [])
    }
  }

  // 3 — fetch referenced properties in one batch.
  const propertyById = new Map<string, { id: string; address: string }>()
  if (propertyIdSet.size > 0) {
    const { data: props } = await admin
      .from('properties')
      .select('id, street_number, street_name, suburb')
      .in('id', Array.from(propertyIdSet))
      .is('deleted_at', null)
    for (const p of props ?? []) {
      const address = [p.street_number, p.street_name].filter(Boolean).join(' ') || p.suburb || '—'
      propertyById.set(p.id, { id: p.id, address })
    }
  }

  const contacts: ContactGridRow[] = baseRows.map((r) => {
    const roles = rolesByContact.get(r.id) ?? []
    const linked = new Map<string, { id: string; address: string }>()
    if (r.residence_property_id) {
      const p = propertyById.get(r.residence_property_id)
      if (p) linked.set(p.id, p)
    }
    for (const role of roles) {
      const p = propertyById.get(role.property_id)
      if (p) linked.set(p.id, p)
    }
    return {
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      email: r.email,
      phone: r.phone,
      score: r.score,
      score_change_7d: r.score_change_7d,
      last_seen_at: r.last_seen_at,
      suburb: r.suburb,
      source: r.source,
      is_stitched: r.is_stitched,
      roles,
      linked_properties: Array.from(linked.values()),
      tracked_link_token: r.tracked_link_token,
      tracked_link_destination_url: r.tracked_link_destination_url,
      tracked_link_last_clicked_at: r.tracked_link_last_clicked_at,
    }
  })

  return { contacts, selectedList, defaultLinkUrl, appUrl }
}
