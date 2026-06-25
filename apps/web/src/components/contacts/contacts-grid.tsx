'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Search,
  Plus,
  BookmarkPlus,
  List,
  Activity,
  Clock,
  MapPin,
  Tag,
  ChevronDown,
  Archive,
  Link2,
  MessageSquare,
  MoreHorizontal,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  PersonAvatar,
  type EngagementValue,
} from '@/lib/design/badges'
import { deriveIdentity, makeInitials } from '@/lib/contacts/identity'
import { roleCounts, type ContactRoleEntry } from '@/lib/contacts/roles'
import { intentForScore, type IntentLevel } from '@/lib/design/intent'
import { AddContactDialog } from './add-contact-dialog'
import { ContactStateDots } from './contact-state-dots'
import { SelectionBar, type SelectionAction } from '@/components/dashboard/selection-bar'
import { AddToListSheet } from '@/components/lists/add-to-list-sheet'
import { useCompanion } from '@/components/companion/companion-context'
import { useLists } from '@/lib/lists/use-lists'
import { BUILTIN_LISTS, type BuiltinListSlug } from '@/lib/lists/builtin'

const ONLINE_MS = 5 * 60 * 1000 // 5 minutes

function isRecentlySeen(ts: string | null): boolean {
  if (!ts) return false
  return Date.now() - new Date(ts).getTime() < ONLINE_MS
}

// ── Public row type — what the server page hands us ──────────────────────────

export interface ContactGridRow {
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
  /** Parsed roles from contacts.metadata. */
  roles: ContactRoleEntry[]
  /** Resolved linked properties (residence + role properties), deduped. */
  linked_properties: Array<{ id: string; address: string }>
  /** HOR-136: per-contact tracked link fields (from get_contacts_list). */
  tracked_link_token: string | null
  tracked_link_destination_url: string | null
  tracked_link_last_clicked_at: string | null
}

interface Props {
  contacts: ContactGridRow[]
  initialQ?: string
  agentId: string
  /** Workspace default destination URL (agent_settings.website_url). Shown
   *  in the edit-destination popover as the fallback when no per-contact
   *  override is set. */
  defaultLinkUrl: string | null
  /** Public app URL — used to build the tracked link `${appUrl}/c/${token}`. */
  appUrl: string
  /** HOR-143/HOR-144: when set, the grid renders inside a list context —
   *  header shows the list banner. Three kinds:
   *   • manual       → rows pre-scoped to membership by the page
   *   • saved_filter → filter_state hydrates the secondary filter bar
   *   • builtin      → rows pre-scoped by score threshold (Warming up /
   *                    Watch closely). id is the slug, not a uuid.
   */
  selectedList?: {
    id: string
    name: string
    kind: 'manual' | 'saved_filter' | 'builtin'
    filter_state: SavedFilterState | null
  } | null
}

// HOR-143: shape we persist to lists.filter_state when "Save as list" fires.
// Loose by design so we can extend without a migration. The grid tolerates
// missing keys when hydrating (falls back to defaults).
export interface SavedFilterState {
  tab?: Tab
  search?: string
  role?: SecondaryFilters['role']
  intensity?: SecondaryFilters['intensity']
  time?: TimeWindow
  property?: string
}

type Tab = 'all' | 'known' | 'unidentified'

type TimeWindow = 'Active anytime' | 'Today' | 'This week' | 'This month' | 'Ever'
const TIME_WINDOWS: TimeWindow[] = ['Active anytime', 'Today', 'This week', 'This month', 'Ever']

interface SecondaryFilters {
  role: 'All' | 'Vendors' | 'Buyers' | 'Landlords' | 'Engaged only'
  list: 'All lists'
  intensity: 'Any' | 'High' | 'Medium' | 'Low'
  time: TimeWindow
  property: string  // 'Any property' or a property id from the row data
}

const HOR_137_TIME_WINDOW_MS: Record<Exclude<TimeWindow, 'Active anytime' | 'Ever'>, number> = {
  'Today':      24 * 60 * 60 * 1000,
  'This week':  7  * 24 * 60 * 60 * 1000,
  'This month': 30 * 24 * 60 * 60 * 1000,
}

function passesTimeWindow(lastSeenIso: string | null, window: TimeWindow): boolean {
  if (window === 'Active anytime') return true
  if (window === 'Ever') return Boolean(lastSeenIso)
  if (!lastSeenIso) return false
  const then = new Date(lastSeenIso).getTime()
  if (Number.isNaN(then)) return false
  return Date.now() - then <= HOR_137_TIME_WINDOW_MS[window]
}

const DEFAULT_FILTERS: SecondaryFilters = {
  role: 'All',
  list: 'All lists',
  intensity: 'Any',
  time: 'Active anytime',
  property: 'Any property',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function engagementForScore(score: number): EngagementValue {
  const i = intentForScore(score)
  if (i === 'high') return 3
  if (i === 'mid')  return 2
  if (i === 'low')  return 1
  return 0
}

function lastSeenLabel(iso: string | null): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1)   return 'Just now'
  if (minutes < 60)  return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)    return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1)    return 'Yesterday'
  if (days < 7)      return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 4)     return `${weeks}w ago`
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

// ── Component ────────────────────────────────────────────────────────────────

export function ContactsGrid({ contacts, initialQ = '', agentId, appUrl, selectedList = null }: Props) {
  const router = useRouter()
  const { openCompanion } = useCompanion()

  // HOR-143: when arriving via a saved_filter list, seed the secondary
  // filters from list.filter_state. Manual lists keep the defaults — the
  // page has already scoped rows to membership. Tolerates missing keys.
  const hydrated = selectedList?.kind === 'saved_filter' ? selectedList.filter_state : null

  const [search, setSearch] = useState(hydrated?.search ?? initialQ)
  const [tab, setTab] = useState<Tab>(hydrated?.tab ?? 'all')
  const [filters, setFilters] = useState<SecondaryFilters>(() => ({
    role:      hydrated?.role      ?? DEFAULT_FILTERS.role,
    list:      'All lists',
    intensity: hydrated?.intensity ?? DEFAULT_FILTERS.intensity,
    time:      hydrated?.time      ?? DEFAULT_FILTERS.time,
    property:  hydrated?.property  ?? DEFAULT_FILTERS.property,
  }))
  const [addOpen, setAddOpen] = useState(false)

  // HOR-143: bulk-select state. Set of contact IDs ticked via row checkbox.
  // Survives filter changes — selecting a contact, then narrowing the
  // filter, doesn't clear the selection (matches Gmail / linear behaviour).
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  // HOR-143: re-hydrate filters when the URL flips between saved-filter
  // lists. useState only seeds on mount; Next.js keeps ContactsGrid mounted
  // across the SSR round-trip, so we need an effect to follow list_id.
  useEffect(() => {
    if (selectedList?.kind !== 'saved_filter') return
    const fs = selectedList.filter_state
    if (!fs) return
    setTab(fs.tab ?? 'all')
    setSearch(fs.search ?? '')
    setFilters({
      role:      fs.role      ?? DEFAULT_FILTERS.role,
      list:      'All lists',
      intensity: fs.intensity ?? DEFAULT_FILTERS.intensity,
      time:      fs.time      ?? DEFAULT_FILTERS.time,
      property:  fs.property  ?? DEFAULT_FILTERS.property,
    })
    // Selection is workspace-wide; if the new list shouldn't include the
    // currently-ticked IDs they'll simply not render in the rows — but
    // clearing on context-switch matches expectations and avoids stale
    // ticks bleeding into a different scope.
    setSelected(new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedList?.id])
  // Add-to-list sheet — three modes:
  //   closed              → no sheet
  //   { kind: 'single' }  → single contactId (from row overflow, deferred)
  //   { kind: 'bulk' }    → batch add of `selected` to a list
  const [bulkSheetOpen, setBulkSheetOpen] = useState(false)
  // "Save as list" dialog state — controlled here so the action lives next
  // to the filter state it'll snapshot.
  const [saveOpen, setSaveOpen] = useState(false)
  // HOR-137: optimistic soft-delete — drop the row from the grid immediately
  // and let router.refresh() catch up on next nav. Listed after the realtime
  // useState block in render order so the diff stays small.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set())

  // Online status — same Realtime channel as v0 grid, simpler state shape.
  const [onlineIds, setOnlineIds] = useState<Set<string>>(() => {
    const safe = Array.isArray(contacts) ? contacts : []
    return new Set(safe.filter((c) => isRecentlySeen(c.last_seen_at)).map((c) => c.id))
  })
  const latestSeenRef = useRef<Map<string, string>>(
    new Map((contacts ?? []).map((c) => [c.id, c.last_seen_at ?? ''])),
  )

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('contacts-online')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'contacts',
          filter: `agent_id=eq.${agentId}`,
        },
        (payload) => {
          const row = payload.new as { id: string; last_seen_at: string | null }
          latestSeenRef.current.set(row.id, row.last_seen_at ?? '')
          setOnlineIds((prev) => {
            const next = new Set(prev)
            if (isRecentlySeen(row.last_seen_at)) next.add(row.id)
            else next.delete(row.id)
            return next
          })
        },
      )
      .subscribe()

    // Tick every 60s to expire stale online statuses
    const interval = setInterval(() => {
      setOnlineIds(() => {
        const next = new Set<string>()
        for (const [id, ts] of latestSeenRef.current) {
          if (isRecentlySeen(ts)) next.add(id)
        }
        return next
      })
    }, 60_000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [agentId])

  // HOR-143: workspace lists for the List filter chip. No contact_id —
  // we just want labels + ids. createList lives on this hook so the
  // Save-as-list dialog can call it without instantiating a second hook.
  const { lists, createList } = useLists()

  // HOR-143/HOR-144: list chip options. Built-ins first (live counts are
  // out of scope for the chip — overview page handles those), then manual,
  // then saved_filter. We encode the choice with a kind hint so the
  // navigation helper writes the right query-string key (?list_id vs
  // ?builtin) without parsing the label back out.
  type ListChoice = { kind: 'all' } | { kind: 'list'; id: string } | { kind: 'builtin'; slug: BuiltinListSlug }
  const listOptions = useMemo(() => {
    const manual = lists
      .filter((l) => l.kind === 'manual')
      .sort((a, b) => a.name.localeCompare(b.name))
    const saved = lists
      .filter((l) => l.kind === 'saved_filter')
      .sort((a, b) => a.name.localeCompare(b.name))
    return [
      { choice: { kind: 'all' } as ListChoice, label: 'All lists' },
      ...BUILTIN_LISTS.map((b) => ({
        choice: { kind: 'builtin' as const, slug: b.slug } as ListChoice,
        label: `◇ ${b.name}`,
      })),
      ...manual.map((l) => ({ choice: { kind: 'list' as const, id: l.id } as ListChoice, label: l.name })),
      ...saved.map((l) => ({ choice: { kind: 'list' as const, id: l.id } as ListChoice, label: `★ ${l.name}` })),
    ]
  }, [lists])

  const currentListLabel = useMemo(() => {
    if (!selectedList) return 'All lists'
    const match = listOptions.find((o) => {
      if (o.choice.kind === 'all') return false
      if (o.choice.kind === 'builtin' && selectedList.kind === 'builtin') {
        return o.choice.slug === selectedList.id
      }
      if (o.choice.kind === 'list' && selectedList.kind !== 'builtin') {
        return o.choice.id === selectedList.id
      }
      return false
    })
    return match?.label ?? selectedList.name
  }, [listOptions, selectedList])

  function handleSelectChoice(choice: ListChoice) {
    const params = new URLSearchParams()
    if (choice.kind === 'list') params.set('list_id', choice.id)
    if (choice.kind === 'builtin') params.set('builtin', choice.slug)
    if (search.trim()) params.set('q', search.trim())
    const qs = params.toString()
    router.push(qs ? `/contacts?${qs}` : '/contacts')
    // The page does an SSR round-trip — clear any in-flight selection so
    // we don't carry stale ticks to a different list's rows.
    setSelected(new Set())
  }

  // Convenience for the banner's Clear button + anywhere else that wants
  // "drop back to the unscoped view".
  function clearListSelection() {
    handleSelectChoice({ kind: 'all' })
  }

  const safeContacts = useMemo(
    () => (Array.isArray(contacts) ? contacts : []).filter((c) => !deletedIds.has(c.id)),
    [contacts, deletedIds],
  )

  // Identity per contact (memoised — used by tabs + rows)
  const identityById = useMemo(() => {
    const m = new Map<string, ReturnType<typeof deriveIdentity>>()
    for (const c of safeContacts) m.set(c.id, deriveIdentity(c))
    return m
  }, [safeContacts])

  const tabCounts = useMemo(() => {
    let known = 0
    let anon = 0
    for (const c of safeContacts) {
      const id = identityById.get(c.id)
      if (id === 'anonymous') anon++
      else known++
    }
    return { all: safeContacts.length, known, unidentified: anon }
  }, [safeContacts, identityById])

  // HOR-137: unique linked-property options for the Property filter chip.
  // Built from rows in scope (post-base, pre-filter) so we don't suggest
  // properties no contact in this workspace references.
  const propertyOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const c of safeContacts) {
      for (const p of c.linked_properties) {
        if (!byId.has(p.id)) byId.set(p.id, p.address)
      }
    }
    const sorted = Array.from(byId.entries()).sort((a, b) =>
      a[1].localeCompare(b[1]),
    )
    return [
      { id: 'Any property', label: 'Any property' },
      ...sorted.map(([id, label]) => ({ id, label })),
    ]
  }, [safeContacts])

  const filtered = useMemo(() => {
    let rows = safeContacts

    // Tab filter
    if (tab === 'known') {
      rows = rows.filter((c) => identityById.get(c.id) !== 'anonymous')
    } else if (tab === 'unidentified') {
      rows = rows.filter((c) => identityById.get(c.id) === 'anonymous')
    }

    // Role filter (wired)
    if (filters.role === 'Vendors') {
      rows = rows.filter((c) => c.roles.some((r) => r.type === 'seller'))
    } else if (filters.role === 'Buyers') {
      rows = rows.filter((c) => c.roles.some((r) => r.type === 'buyer'))
    } else if (filters.role === 'Landlords') {
      rows = rows.filter((c) => c.roles.some((r) => r.type === 'landlord'))
    } else if (filters.role === 'Engaged only') {
      rows = rows.filter((c) => c.roles.length === 0 && c.score >= 5)
    }

    // Intensity filter (wired)
    if (filters.intensity !== 'Any') {
      const target = filters.intensity === 'High' ? 3 : filters.intensity === 'Medium' ? 2 : 1
      rows = rows.filter((c) => engagementForScore(c.score) === target)
    }

    // Time window filter (HOR-137 — client-side over last_seen_at)
    if (filters.time !== 'Active anytime') {
      rows = rows.filter((c) => passesTimeWindow(c.last_seen_at, filters.time))
    }

    // Property filter (HOR-137 — client-side over linked_properties)
    if (filters.property !== 'Any property') {
      rows = rows.filter((c) =>
        c.linked_properties.some((p) => p.id === filters.property),
      )
    }

    // List filter is applied server-side via ?list_id (manual lists pin
    // membership, saved_filter lists hydrate the bar — see page.tsx).

    // Search
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter((c) =>
        [c.first_name, c.last_name, c.email, c.suburb]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
    }

    return rows
  }, [safeContacts, identityById, tab, filters, search])

  // HOR-143: "Save as list" is meaningful only when SOMETHING narrows the
  // view — otherwise saving captures "all contacts" which is just a copy of
  // your book. Match the design intent: at least one filter / search /
  // non-default tab is active.
  const hasActiveFilter =
    tab !== 'all' ||
    search.trim().length > 0 ||
    filters.role !== DEFAULT_FILTERS.role ||
    filters.intensity !== DEFAULT_FILTERS.intensity ||
    filters.time !== DEFAULT_FILTERS.time ||
    filters.property !== DEFAULT_FILTERS.property

  function snapshotFilterState(): SavedFilterState {
    return {
      tab,
      search: search.trim() || undefined,
      role: filters.role,
      intensity: filters.intensity,
      time: filters.time,
      property: filters.property,
    }
  }

  const selectedIds = useMemo(() => Array.from(selected), [selected])
  const allVisibleSelected =
    filtered.length > 0 && filtered.every((c) => selected.has(c.id))

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const c of filtered) next.delete(c.id)
      } else {
        for (const c of filtered) next.add(c.id)
      }
      return next
    })
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── HOR-246: SelectionBar actions (replaces the v1 fixed-bottom pill) ──────
  const [archiving, setArchiving] = useState(false)

  const selectedRows = useMemo(
    () => safeContacts.filter((c) => selected.has(c.id)),
    [safeContacts, selected],
  )

  function handleMessage() {
    const names = selectedRows
      .map((c) => [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email)
      .filter(Boolean)
    const label =
      names.length === 1 ? names[0]! : `${selected.size} contacts`
    openCompanion({
      prompt: `Draft a message to ${label}`,
      contextLabel: names.length === 1 ? `Contact: ${names[0]}` : 'Contacts',
    })
  }

  async function handleCopyLinks() {
    const urls = selectedRows
      .filter((c) => c.tracked_link_token)
      .map((c) => `${appUrl}/c/${c.tracked_link_token}`)
    if (urls.length === 0) {
      // No tracked links on the selection — nothing to copy. Silent no-op
      // beats an error toast; the agent can still see the link column gone.
      return
    }
    try {
      await navigator.clipboard.writeText(urls.join('\n'))
    } catch (err) {
      console.warn('[contacts] copy links failed:', err)
    }
  }

  async function handleArchive() {
    if (archiving) return
    const n = selected.size
    if (!window.confirm(`Archive ${n} ${n === 1 ? 'contact' : 'contacts'}? You can restore them within 30 days.`)) {
      return
    }
    setArchiving(true)
    const ids = Array.from(selected)
    const results = await Promise.allSettled(
      ids.map((id) => fetch(`/api/contacts/${id}`, { method: 'DELETE' })),
    )
    const archived = ids.filter((_, i) => results[i].status === 'fulfilled' && (results[i] as PromiseFulfilledResult<Response>).value.ok)
    setDeletedIds((prev) => {
      const next = new Set(prev)
      for (const id of archived) next.add(id)
      return next
    })
    setSelected(new Set())
    setArchiving(false)
  }

  const selectionActions: SelectionAction[] = [
    { label: 'Message', icon: MessageSquare, onClick: handleMessage },
    { label: 'Add to list', icon: BookmarkPlus, onClick: () => setBulkSheetOpen(true) },
    { label: 'Copy links', icon: Link2, onClick: handleCopyLinks },
    { label: 'Archive', icon: Archive, onClick: handleArchive, disabled: archiving },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '28px 32px 80px',
        }}
      >
        <div style={{ maxWidth: 1200 }}>
          {/* Page header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 16,
              marginBottom: 22,
            }}
          >
            <div>
              <h1
                className="font-display"
                style={{
                  margin: 0,
                  fontSize: 32,
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                  color: '#1A1612',
                }}
              >
                Contacts
              </h1>
              <p
                style={{
                  margin: '6px 0 0',
                  fontSize: 13,
                  color: '#8C7B6B',
                  maxWidth: 560,
                  lineHeight: 1.5,
                }}
              >
                Your book — who&rsquo;s stirring, who&rsquo;s known, and who&rsquo;s resolving from
                anonymous into named.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 7,
                background: '#1A1612',
                color: '#FAF7F2',
                fontSize: 13,
                fontWeight: 500,
                border: '1px solid #1A1612',
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
              }}
            >
              <Plus style={{ width: 14, height: 14 }} />
              Add contact
            </button>
          </div>

          {/* Tabs + search */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              marginBottom: 12,
              borderBottom: '1px solid rgba(140,123,107,0.16)',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', gap: 0 }}>
              <TabButton label="All"          count={tabCounts.all}          active={tab === 'all'}          onClick={() => setTab('all')} />
              <TabButton label="Known"        count={tabCounts.known}        active={tab === 'known'}        onClick={() => setTab('known')} />
              <TabButton label="Unidentified" count={tabCounts.unidentified} active={tab === 'unidentified'} onClick={() => setTab('unidentified')} />
            </div>

            <div
              className="contacts-search"
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                background: '#FAF7F2',
                border: '1px solid rgba(140,123,107,0.22)',
                borderRadius: 6,
                marginBottom: 6,
              }}
            >
              <Search style={{ width: 13, height: 13, color: '#8C7B6B' }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email…"
                style={{
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontSize: 12,
                  fontFamily: 'var(--font-body)',
                  color: '#1A1612',
                  width: 200,
                }}
              />
            </div>
          </div>

          {/* HOR-143: selected-list banner. Renders when a list is pinned
              via ?list_id. Distinguishes manual (rows scoped) from
              saved_filter (filters hydrated). */}
          {selectedList && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                margin: '6px 0 12px',
                padding: '8px 12px',
                background: 'rgba(196,98,45,0.06)',
                border: '1px solid rgba(196,98,45,0.22)',
                borderRadius: 7,
                fontSize: 12,
                color: '#1A1612',
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: '#C4622D',
                }}
              >
                {selectedList.kind === 'saved_filter'
                  ? 'Saved view'
                  : selectedList.kind === 'builtin'
                  ? 'Built-in'
                  : 'List'}
              </span>
              <span style={{ fontWeight: 500 }}>{selectedList.name}</span>
              <span style={{ color: '#8C7B6B' }}>
                {selectedList.kind === 'saved_filter'
                  ? '· filters hydrated from this view'
                  : selectedList.kind === 'builtin'
                  ? '· computed live from behaviour signals'
                  : '· showing only members'}
              </span>
              <button
                type="button"
                onClick={clearListSelection}
                style={{
                  marginLeft: 'auto',
                  background: 'transparent',
                  border: 'none',
                  color: '#5E5246',
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                }}
              >
                Clear
              </button>
            </div>
          )}

          {/* Secondary filter chips */}
          <SecondaryFilterBar
            filters={filters}
            propertyOptions={propertyOptions}
            onChange={(next) => setFilters((f) => ({ ...f, ...next }))}
            resultCount={filtered.length}
            totalCount={safeContacts.length}
            listOptions={listOptions}
            currentListLabel={currentListLabel}
            onSelectChoice={handleSelectChoice}
            saveAsListDisabled={!hasActiveFilter}
            onSaveAsList={() => setSaveOpen(true)}
          />

          {/* HOR-246: selection-driven action bar — inline above the table,
              replaces the v1 fixed-bottom pill. */}
          {selected.size > 0 && (
            <SelectionBar
              count={selected.size}
              actions={selectionActions}
              onClear={() => setSelected(new Set())}
            />
          )}

          {/* Table */}
          <div
            style={{
              background: '#FAF7F2',
              border: '1px solid rgba(140,123,107,0.2)',
              borderRadius: 10,
              overflow: 'hidden',
            }}
          >
            <TableHead
              allChecked={allVisibleSelected}
              indeterminate={!allVisibleSelected && filtered.some((c) => selected.has(c.id))}
              onToggleAll={toggleAllVisible}
            />
            {filtered.length === 0 ? (
              <EmptyState search={search} hasAnyContacts={safeContacts.length > 0} />
            ) : (
              filtered.map((c, idx) => (
                <ContactRow
                  key={c.id}
                  contact={c}
                  identity={identityById.get(c.id) ?? 'anonymous'}
                  isOnline={onlineIds.has(c.id)}
                  isLast={idx === filtered.length - 1}
                  onClick={() => router.push(`/contacts/${c.id}`)}
                  isSelected={selected.has(c.id)}
                  onToggleSelect={() => toggleOne(c.id)}
                />
              ))
            )}
          </div>

          <p
            style={{
              marginTop: 20,
              fontSize: 11,
              color: '#8C7B6B',
              fontStyle: 'italic',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>Your people, your history. Behaviour belongs to you — sovereign across every tool you ever use.</span>
          </p>
        </div>
      </div>

      {addOpen && (
        <AddContactDialog
          onClose={() => setAddOpen(false)}
          onComplete={() => {
            setAddOpen(false)
            router.refresh()
          }}
        />
      )}

      <AddToListSheet
        open={bulkSheetOpen}
        onClose={() => setBulkSheetOpen(false)}
        contactIds={selectedIds}
        subjectLabel={`${selected.size} contacts`}
      />

      {saveOpen && (
        <SaveAsListDialog
          onClose={() => setSaveOpen(false)}
          onSave={async (name) => {
            const list = await createList({
              name,
              kind: 'saved_filter',
              filter_state: snapshotFilterState() as unknown as Record<string, unknown>,
            })
            setSaveOpen(false)
            // Navigate to the saved view so the user sees the new banner
            // and the filters are clearly "stored" rather than ephemeral.
            router.push(`/contacts?list_id=${list.id}`)
          }}
        />
      )}
    </div>
  )
}

// ── Save-as-list dialog ─────────────────────────────────────────────────────
// HOR-143: small modal for naming a saved_filter list. Mounted only when
// the user clicks "Save as list" on the filter bar. Owns its own name +
// pending state so the parent doesn't have to.

function SaveAsListDialog({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (name: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    setError(null)
    try {
      await onSave(trimmed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
      setSaving(false)
    }
  }

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(26,22,18,0.36)',
        padding: 16,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%',
          maxWidth: 360,
          background: '#FAF7F2',
          border: '1px solid rgba(140,123,107,0.22)',
          borderRadius: 12,
          boxShadow: '0 20px 48px rgba(26,22,18,0.18)',
          padding: '18px 20px',
          fontFamily: 'var(--font-body)',
          color: '#1A1612',
        }}
      >
        <h3
          className="font-display"
          style={{
            margin: '0 0 4px',
            fontSize: 17,
            fontWeight: 500,
            letterSpacing: '-0.01em',
          }}
        >
          Save as list
        </h3>
        <p style={{ margin: '0 0 14px', fontSize: 12, color: '#8C7B6B' }}>
          Capture the current filter as a saved view you can return to.
        </p>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Paddington warming up"
          maxLength={80}
          style={{
            width: '100%',
            padding: '9px 11px',
            fontSize: 13,
            fontFamily: 'var(--font-body)',
            color: '#1A1612',
            background: '#FFFFFF',
            border: '1px solid rgba(140,123,107,0.28)',
            borderRadius: 6,
            outline: 'none',
            boxSizing: 'border-box',
            marginBottom: 14,
          }}
        />
        {error && (
          <p role="alert" style={{ margin: '0 0 12px', fontSize: 12, color: '#9C4A1F' }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              padding: '8px 12px',
              fontSize: 12,
              color: '#5E5246',
              background: 'transparent',
              border: 'none',
              borderRadius: 6,
              cursor: saving ? 'wait' : 'pointer',
              fontFamily: 'var(--font-body)',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            style={{
              padding: '8px 14px',
              fontSize: 12,
              fontWeight: 500,
              color: '#FAF7F2',
              background: '#1A1612',
              border: 'none',
              borderRadius: 6,
              cursor: saving || !name.trim() ? 'not-allowed' : 'pointer',
              opacity: saving || !name.trim() ? 0.55 : 1,
              fontFamily: 'var(--font-body)',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Tab button ───────────────────────────────────────────────────────────────

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '10px 14px',
        fontSize: 13,
        fontWeight: 500,
        color: active ? '#1A1612' : '#8C7B6B',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid #C4622D' : '2px solid transparent',
        cursor: 'pointer',
        fontFamily: 'var(--font-body)',
        marginBottom: -1,
      }}
    >
      {label}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: active ? '#C4622D' : '#8C7B6B',
          background: active ? 'rgba(196,98,45,0.14)' : 'rgba(140,123,107,0.12)',
          padding: '1px 7px',
          borderRadius: 9999,
        }}
      >
        {count}
      </span>
    </button>
  )
}

// ── Secondary filter chips ────────────────────────────────────────────────────

interface FilterChipProps {
  label: string
  Icon: typeof Tag
  isActive: boolean
  options: string[]
  current: string
  onSelect: (v: string) => void
  disabledTooltip?: string
}

function FilterChip({ label, Icon, isActive, options, current, onSelect, disabledTooltip }: FilterChipProps) {
  const [open, setOpen] = useState(false)
  const disabled = Boolean(disabledTooltip)
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        title={disabledTooltip}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 11px',
          borderRadius: 6,
          fontSize: 11.5,
          fontWeight: 500,
          background: isActive ? 'rgba(196,98,45,0.08)' : '#FAF7F2',
          color: isActive ? '#C4622D' : '#5E5246',
          border: `1px solid ${isActive ? 'rgba(196,98,45,0.25)' : 'rgba(140,123,107,0.22)'}`,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          fontFamily: 'var(--font-body)',
        }}
      >
        <Icon style={{ width: 11, height: 11, opacity: 0.7 }} />
        {label}: <span style={{ fontWeight: 600 }}>{current}</span>
        <ChevronDown style={{ width: 11, height: 11, opacity: 0.5 }} />
      </button>
      {open && !disabled && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 15 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              zIndex: 20,
              background: '#FAF7F2',
              border: '1px solid rgba(140,123,107,0.22)',
              borderRadius: 8,
              boxShadow: '0 12px 32px rgba(26,22,18,0.18)',
              padding: 4,
              minWidth: 180,
            }}
          >
            {options.map((opt) => (
              <div
                key={opt}
                onClick={() => {
                  onSelect(opt)
                  setOpen(false)
                }}
                style={{
                  padding: '7px 10px',
                  fontSize: 12,
                  color: '#1A1612',
                  cursor: 'pointer',
                  borderRadius: 5,
                  background: current === opt ? 'rgba(196,98,45,0.08)' : 'transparent',
                }}
              >
                {opt}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Re-declared at the bar's seam so the chip props don't have to import
// the inner ListChoice from the function scope above.
type ListChipChoice =
  | { kind: 'all' }
  | { kind: 'list'; id: string }
  | { kind: 'builtin'; slug: BuiltinListSlug }

function SecondaryFilterBar({
  filters,
  propertyOptions,
  onChange,
  resultCount,
  totalCount,
  listOptions,
  currentListLabel,
  onSelectChoice,
  saveAsListDisabled,
  onSaveAsList,
}: {
  filters: SecondaryFilters
  propertyOptions: Array<{ id: string; label: string }>
  onChange: (next: Partial<SecondaryFilters>) => void
  resultCount: number
  totalCount: number
  // HOR-143/HOR-144: List chip drives a URL change (and SSR re-fetch).
  // Built-ins and real lists share the dropdown — the choice object tells
  // the parent which query-string key to write.
  listOptions: Array<{ choice: ListChipChoice; label: string }>
  currentListLabel: string
  onSelectChoice: (choice: ListChipChoice) => void
  saveAsListDisabled: boolean
  onSaveAsList: () => void
}) {
  // Property chip uses id-as-value, address-as-label. Find the address for
  // the current selection so the chip surfaces something readable.
  const currentPropertyLabel =
    filters.property === 'Any property'
      ? 'Any property'
      : (propertyOptions.find((p) => p.id === filters.property)?.label ?? 'Any property')
  const propertyLabelToId = new Map(propertyOptions.map((p) => [p.label, p.id]))
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 14,
        marginTop: 10,
        flexWrap: 'wrap',
      }}
    >
      <FilterChip
        label="Role"
        Icon={Tag}
        isActive={filters.role !== 'All'}
        current={filters.role}
        options={['All', 'Vendors', 'Buyers', 'Landlords', 'Engaged only']}
        onSelect={(v) => onChange({ role: v as SecondaryFilters['role'] })}
      />
      <FilterChip
        label="List"
        Icon={List}
        isActive={currentListLabel !== 'All lists'}
        current={currentListLabel}
        options={listOptions.map((o) => o.label)}
        onSelect={(label) => {
          const match = listOptions.find((o) => o.label === label)
          if (match) onSelectChoice(match.choice)
        }}
      />
      <FilterChip
        label="Intensity"
        Icon={Activity}
        isActive={filters.intensity !== 'Any'}
        current={filters.intensity}
        options={['Any', 'High', 'Medium', 'Low']}
        onSelect={(v) => onChange({ intensity: v as SecondaryFilters['intensity'] })}
      />
      <FilterChip
        label="Time"
        Icon={Clock}
        isActive={filters.time !== 'Active anytime'}
        current={filters.time}
        options={TIME_WINDOWS}
        onSelect={(v) => onChange({ time: v as TimeWindow })}
      />
      <FilterChip
        label="Property"
        Icon={MapPin}
        isActive={filters.property !== 'Any property'}
        current={currentPropertyLabel}
        options={propertyOptions.map((p) => p.label)}
        onSelect={(label) => {
          const id = propertyLabelToId.get(label) ?? 'Any property'
          onChange({ property: id })
        }}
      />

      <div
        style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: '#8C7B6B',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {resultCount} of {totalCount}
        </span>
        <button
          type="button"
          disabled={saveAsListDisabled}
          onClick={onSaveAsList}
          title={
            saveAsListDisabled
              ? 'Apply a filter or search first'
              : 'Save the current view as a list'
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 9px',
            borderRadius: 6,
            background: saveAsListDisabled ? 'transparent' : 'rgba(196,98,45,0.08)',
            color: saveAsListDisabled ? '#5E5246' : '#C4622D',
            fontSize: 11,
            fontWeight: 500,
            border: saveAsListDisabled
              ? '1px dashed rgba(140,123,107,0.3)'
              : '1px solid rgba(196,98,45,0.25)',
            cursor: saveAsListDisabled ? 'not-allowed' : 'pointer',
            opacity: saveAsListDisabled ? 0.55 : 1,
            fontFamily: 'var(--font-body)',
          }}
        >
          <BookmarkPlus style={{ width: 12, height: 12 }} />
          Save as list
        </button>
      </div>
    </div>
  )
}

// ── Table head ───────────────────────────────────────────────────────────────

// HOR-246: v2 row trims to name + state dots + linked-count badge / email,
// then Role / Suburb / Intensity / Last seen. The v1 roles-badges,
// engagement-indicator, property-thumbs, tracked-link cell, and overflow
// kebab are gone — bulk actions live in the SelectionBar.
const COL_STYLES = {
  check:     { width: 28,  flexGrow: 0, flexShrink: 0, display: 'flex', justifyContent: 'center' },
  contact:   { flex: 2,    minWidth: 220 },
  role:      { width: 100, flexGrow: 0, flexShrink: 0 },
  suburb:    { width: 120, flexGrow: 0, flexShrink: 0 },
  intensity: { width: 110, flexGrow: 0, flexShrink: 0 },
  lastSeen:  { width: 80,  flexGrow: 0, flexShrink: 0 },
} as const

function TableHead({
  allChecked,
  indeterminate,
  onToggleAll,
}: {
  allChecked: boolean
  indeterminate: boolean
  onToggleAll: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '11px 16px',
        borderBottom: '1px solid rgba(140,123,107,0.18)',
        background: 'rgba(245,240,232,0.5)',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: '#8C7B6B',
      }}
    >
      <span style={COL_STYLES.check}>
        <RowCheckbox
          checked={allChecked}
          indeterminate={indeterminate}
          onClick={onToggleAll}
          ariaLabel="Select all visible rows"
        />
      </span>
      <span style={COL_STYLES.contact}>Contact</span>
      <span style={COL_STYLES.role}>Role</span>
      <span style={COL_STYLES.suburb}>Suburb</span>
      <span style={COL_STYLES.intensity}>Intensity</span>
      <span style={COL_STYLES.lastSeen}>Last seen</span>
    </div>
  )
}

// HOR-143: small checkbox visual reused across header + rows. We don't use
// a native <input> here because the parchment palette and 16px square spec
// match the existing AddToListSheet's tick look — keeps the visual family
// consistent. Indeterminate is the "some-but-not-all-visible-selected" state.
function RowCheckbox({
  checked,
  indeterminate = false,
  onClick,
  ariaLabel,
}: {
  checked: boolean
  indeterminate?: boolean
  onClick: () => void
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        padding: 0,
        borderRadius: 4,
        border: checked || indeterminate
          ? '1px solid #3D5246'
          : '1px solid rgba(140,123,107,0.4)',
        background: checked || indeterminate ? '#3D5246' : '#FFFFFF',
        color: '#FAF7F2',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {indeterminate ? (
        <span
          style={{
            display: 'block',
            width: 8,
            height: 2,
            background: '#FAF7F2',
            borderRadius: 1,
          }}
        />
      ) : checked ? (
        <svg viewBox="0 0 16 16" width={11} height={11} aria-hidden>
          <path
            d="M3 8.5 6.5 12 13 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </button>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

// HOR-246: intensity → 3-bar indicator + label, matching the prototype's
// inline bars. Mirrors the digest intent palette. `intentForScore` returns
// null for the quietest contacts — that maps to the 0-bar "Quiet" state.
const INTENT_BARS: Record<IntentLevel | 'none', { level: number; color: string; label: string }> = {
  high: { level: 3, color: '#A85220', label: 'High' },
  mid:  { level: 2, color: '#7A6112', label: 'Mid' },
  low:  { level: 1, color: '#3D5246', label: 'Patient' },
  none: { level: 0, color: '#8C7B6B', label: 'Quiet' },
}

function roleLabel(contact: ContactGridRow): string {
  const counts = roleCounts(contact.roles)
  if (counts.seller > 0 && counts.buyer > 0) return 'Vendor/Buyer'
  if (counts.seller > 0) return 'Vendor'
  if (counts.buyer > 0) return 'Buyer'
  if (counts.landlord > 0) return 'Landlord'
  if (contact.score >= 5) return 'Engaged'
  return '—'
}

function ContactRow({
  contact,
  identity,
  isOnline,
  isLast,
  onClick,
  isSelected,
  onToggleSelect,
}: {
  contact: ContactGridRow
  identity: ReturnType<typeof deriveIdentity>
  isOnline: boolean
  isLast: boolean
  onClick: () => void
  isSelected: boolean
  onToggleSelect: () => void
}) {
  const isAnon = identity === 'anonymous'
  const initials = makeInitials(contact)
  const name =
    [contact.first_name, contact.last_name].filter(Boolean).join(' ') ||
    contact.email ||
    `Visitor · ${contact.id.slice(0, 4)}`
  const email = isAnon
    ? `Tracked · ${contact.source}`
    : contact.email ?? contact.phone ?? contact.suburb ?? '—'
  const bars = INTENT_BARS[intentForScore(contact.score) ?? 'none']
  const linkedCount = contact.linked_properties.length

  return (
    <div
      role="link"
      tabIndex={0}
      className="grid-row"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        borderBottom: isLast ? 'none' : '1px solid rgba(140,123,107,0.12)',
        cursor: 'pointer',
        transition: 'background 120ms',
        background: isSelected ? 'rgba(196,98,45,0.06)' : undefined,
      }}
    >
      {/* Select checkbox */}
      <span style={COL_STYLES.check}>
        <RowCheckbox
          checked={isSelected}
          onClick={onToggleSelect}
          ariaLabel={`Select ${contact.first_name ?? contact.email ?? contact.id}`}
        />
      </span>

      {/* Contact — 32px avatar + name + state dots + linked-count badge / email */}
      <div style={{ ...COL_STYLES.contact, minWidth: 0, display: 'flex', alignItems: 'center', gap: 11 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <PersonAvatar initials={initials} identity={identity} size={32} anonymous={isAnon} />
          {isOnline && !isAnon && (
            <span
              title="Online now"
              style={{
                position: 'absolute',
                bottom: -1,
                right: -1,
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: '#3DA361',
                border: '2px solid #FAF7F2',
                animation: 'online-pulse 2s ease-in-out infinite',
              }}
            />
          )}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: isAnon ? '#5E5246' : '#1A1612',
                fontStyle: isAnon ? 'italic' : 'normal',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: '0 1 auto',
                minWidth: 0,
              }}
            >
              {name}
            </span>
            <ContactStateDots identity={identity} />
            {linkedCount > 0 && (
              <span
                title={`${linkedCount} linked ${linkedCount === 1 ? 'property' : 'properties'}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 15,
                  height: 15,
                  borderRadius: 4,
                  background: 'rgba(181,146,42,0.18)',
                  color: '#7A6112',
                  fontSize: 9,
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  flexShrink: 0,
                }}
              >
                {linkedCount}
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 11,
              color: '#8C7B6B',
              marginTop: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {email}
          </div>
        </div>
      </div>

      {/* Role */}
      <div style={{ ...COL_STYLES.role, fontSize: 12, color: '#5E5246' }}>
        {roleLabel(contact)}
      </div>

      {/* Suburb */}
      <div style={{ ...COL_STYLES.suburb, fontSize: 12.5, color: '#1A1612' }}>
        {contact.suburb ?? <span style={{ color: '#8C7B6B' }}>—</span>}
      </div>

      {/* Intensity — 3 bars + label */}
      <div style={{ ...COL_STYLES.intensity }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11.5,
            fontWeight: 500,
            color: bars.color,
          }}
        >
          <span style={{ display: 'inline-flex', gap: 1, alignItems: 'flex-end' }}>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: 3,
                  height: 9 + i * 2,
                  borderRadius: 1,
                  background: i < bars.level ? bars.color : 'rgba(140,123,107,0.2)',
                }}
              />
            ))}
          </span>
          {bars.label}
        </span>
      </div>

      {/* Last seen */}
      <div
        style={{
          ...COL_STYLES.lastSeen,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: '#6E5F50',
        }}
      >
        {lastSeenLabel(contact.last_seen_at)}
      </div>
    </div>
  )
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ search, hasAnyContacts }: { search: string; hasAnyContacts: boolean }) {
  // Two-line pattern (HOR-135 #5): acknowledge + Horace's next move.
  const line1 = search
    ? `Nothing matches "${search}" yet.`
    : !hasAnyContacts
      ? "Horace hasn't met anyone yet."
      : 'Nothing matches this view yet.'
  const line2 = search
    ? 'Try a different search, or adjust the filters above.'
    : !hasAnyContacts
      ? 'Import your contacts so Horace can recognise them when they visit your site.'
      : 'Adjust filters, or add a contact.'

  return (
    <div style={{ padding: '48px 24px', textAlign: 'center', background: '#FAF7F2' }}>
      <p style={{ fontSize: 13, fontWeight: 500, color: '#5E5246', marginBottom: 6 }}>{line1}</p>
      <p style={{ fontSize: 12, color: '#8C7B6B', marginBottom: !hasAnyContacts && !search ? 18 : 0 }}>
        {line2}
      </p>
      {!search && !hasAnyContacts && (
        <Link
          href="/import"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 8,
            background: '#C4622D',
            color: '#FAF7F2',
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Import contacts
        </Link>
      )}
    </div>
  )
}
