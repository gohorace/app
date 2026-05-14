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
} from 'lucide-react'
import { RowOverflowMenu, ExternalLink, Trash2 } from '@/components/dashboard/row-overflow-menu'
import { createClient } from '@/lib/supabase/client'
import {
  IdentityGradient,
  RoleBadge,
  EngagementIndicator,
  PersonAvatar,
  PropertyThumbStack,
  toneFor,
  type EngagementValue,
} from '@/lib/design/badges'
import { deriveIdentity, makeInitials } from '@/lib/contacts/identity'
import { roleCounts, type ContactRoleEntry } from '@/lib/contacts/roles'
import { intentForScore } from '@/lib/design/intent'
import { AddContactDialog } from './add-contact-dialog'
import { TrackedLinkCell } from './tracked-link-cell'

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
}

type Tab = 'all' | 'known' | 'unidentified'

type TimeWindow = 'Active anytime' | 'Today' | 'This week' | 'This month' | 'Ever'
const TIME_WINDOWS: TimeWindow[] = ['Active anytime', 'Today', 'This week', 'This month', 'Ever']

interface SecondaryFilters {
  role: 'All' | 'Sellers' | 'Buyers' | 'Engaged only'
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

export function ContactsGrid({ contacts, initialQ = '', agentId, defaultLinkUrl, appUrl }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState(initialQ)
  const [tab, setTab] = useState<Tab>('all')
  const [filters, setFilters] = useState<SecondaryFilters>(DEFAULT_FILTERS)
  const [addOpen, setAddOpen] = useState(false)
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
    if (filters.role === 'Sellers') {
      rows = rows.filter((c) => c.roles.some((r) => r.type === 'seller'))
    } else if (filters.role === 'Buyers') {
      rows = rows.filter((c) => c.roles.some((r) => r.type === 'buyer'))
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

    // List dropdown is rendered but inert in V1 (Lists feature deferred).

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

          {/* Secondary filter chips */}
          <SecondaryFilterBar
            filters={filters}
            propertyOptions={propertyOptions}
            onChange={(next) => setFilters((f) => ({ ...f, ...next }))}
            resultCount={filtered.length}
            totalCount={safeContacts.length}
          />

          {/* Table */}
          <div
            style={{
              background: '#FAF7F2',
              border: '1px solid rgba(140,123,107,0.2)',
              borderRadius: 10,
              overflow: 'hidden',
            }}
          >
            <TableHead />
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
                  appUrl={appUrl}
                  defaultLinkUrl={defaultLinkUrl}
                  onClick={() => router.push(`/contacts/${c.id}`)}
                  onSoftDelete={(id) => setDeletedIds((prev) => {
                    const next = new Set(prev)
                    next.add(id)
                    return next
                  })}
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

function SecondaryFilterBar({
  filters,
  propertyOptions,
  onChange,
  resultCount,
  totalCount,
}: {
  filters: SecondaryFilters
  propertyOptions: Array<{ id: string; label: string }>
  onChange: (next: Partial<SecondaryFilters>) => void
  resultCount: number
  totalCount: number
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
        options={['All', 'Sellers', 'Buyers', 'Engaged only']}
        onSelect={(v) => onChange({ role: v as SecondaryFilters['role'] })}
      />
      <FilterChip
        label="List"
        Icon={List}
        isActive={false}
        current={filters.list}
        options={['All lists']}
        onSelect={() => {}}
        disabledTooltip="Lists coming soon"
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
          disabled
          title="Lists coming soon"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 9px',
            borderRadius: 6,
            background: 'transparent',
            color: '#5E5246',
            fontSize: 11,
            fontWeight: 500,
            border: '1px dashed rgba(140,123,107,0.3)',
            cursor: 'not-allowed',
            opacity: 0.55,
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

const COL_STYLES = {
  avatar:    { width: 52,   flexGrow: 0, flexShrink: 0 },
  contact:   { flex: 2.2,   minWidth: 200 },
  roles:     { flex: 1.4,   minWidth: 130 },
  suburb:    { flex: 0.9,   minWidth: 90  },
  engagement:{ flex: 1.0,   minWidth: 110 },
  properties:{ flex: 1.2,   minWidth: 120 },
  lastSeen:  { flex: 0.7,   minWidth: 70  },
  link:      { flex: 1.0,   minWidth: 140 },
  overflow:  { width: 36,   flexGrow: 0, flexShrink: 0 },
} as const

function TableHead() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '11px 18px',
        borderBottom: '1px solid rgba(140,123,107,0.18)',
        background: 'rgba(245,240,232,0.5)',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: '#8C7B6B',
      }}
    >
      <span style={COL_STYLES.avatar} />
      <span style={COL_STYLES.contact}>Contact</span>
      <span style={COL_STYLES.roles}>Roles</span>
      <span style={COL_STYLES.suburb}>Suburb</span>
      <span style={COL_STYLES.engagement}>Engagement</span>
      <span style={COL_STYLES.properties}>Linked properties</span>
      <span style={COL_STYLES.lastSeen}>Last seen</span>
      <span style={COL_STYLES.link}>Link</span>
      <span style={COL_STYLES.overflow} />
    </div>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

function ContactRow({
  contact,
  identity,
  isOnline,
  isLast,
  appUrl,
  defaultLinkUrl,
  onClick,
  onSoftDelete,
}: {
  contact: ContactGridRow
  identity: ReturnType<typeof deriveIdentity>
  isOnline: boolean
  isLast: boolean
  appUrl: string
  defaultLinkUrl: string | null
  onClick: () => void
  onSoftDelete: (id: string) => void
}) {
  const isAnon = identity === 'anonymous'
  const counts = roleCounts(contact.roles)
  const initials = makeInitials(contact)
  const name =
    [contact.first_name, contact.last_name].filter(Boolean).join(' ') ||
    contact.email ||
    `Visitor · ${contact.id.slice(0, 4)}`
  const subline = isAnon
    ? `Tracked · ${contact.source}`
    : contact.email ?? contact.phone ?? contact.suburb ?? '—'

  const linkedThumbs = contact.linked_properties.map((p) => ({
    address: p.address,
    tone: toneFor(p.id),
  }))

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
        gap: 14,
        padding: '14px 18px',
        borderBottom: isLast ? 'none' : '1px solid rgba(140,123,107,0.1)',
        cursor: 'pointer',
        transition: 'background 120ms',
      }}
    >
      {/* Avatar */}
      <div style={{ ...COL_STYLES.avatar, position: 'relative' }}>
        <PersonAvatar
          initials={initials}
          identity={identity}
          size={44}
          anonymous={isAnon}
        />
        {isOnline && !isAnon && (
          <span
            title="Online now"
            style={{
              position: 'absolute',
              bottom: 0,
              right: 4,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#3DA361',
              border: '2px solid #FAF7F2',
              animation: 'online-pulse 2s ease-in-out infinite',
            }}
          />
        )}
      </div>

      {/* Contact (name + identity gradient + subline) */}
      <div style={{ ...COL_STYLES.contact, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 3,
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: isAnon ? '#5E5246' : '#1A1612',
              fontStyle: isAnon ? 'italic' : 'normal',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {name}
          </span>
          <IdentityGradient state={identity} />
        </div>
        <div
          style={{
            fontSize: 12,
            color: '#8C7B6B',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {subline}
        </div>
      </div>

      {/* Roles */}
      <div style={{ ...COL_STYLES.roles, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {counts.seller > 0 && <RoleBadge role="seller" count={counts.seller} />}
        {counts.buyer  > 0 && <RoleBadge role="buyer"  count={counts.buyer}  />}
        {counts.seller === 0 && counts.buyer === 0 && contact.score >= 5 && (
          <RoleBadge role="engaged" />
        )}
        {counts.seller === 0 && counts.buyer === 0 && contact.score < 5 && !isAnon && (
          <span style={{ fontSize: 11, color: '#8C7B6B', fontStyle: 'italic' }}>—</span>
        )}
      </div>

      {/* Suburb */}
      <div style={{ ...COL_STYLES.suburb, fontSize: 12, color: '#5E5246' }}>
        {contact.suburb ?? <span style={{ color: '#8C7B6B' }}>—</span>}
      </div>

      {/* Engagement */}
      <div style={{ ...COL_STYLES.engagement, display: 'flex', alignItems: 'center' }}>
        <EngagementIndicator value={engagementForScore(contact.score)} showLabel />
      </div>

      {/* Linked properties */}
      <div style={{ ...COL_STYLES.properties, display: 'flex', alignItems: 'center', gap: 10 }}>
        {linkedThumbs.length > 0 ? (
          <>
            <PropertyThumbStack properties={linkedThumbs} />
            <span style={{ fontSize: 12, color: '#5E5246' }}>{linkedThumbs.length}</span>
          </>
        ) : (
          <span style={{ fontSize: 12, color: '#8C7B6B', fontStyle: 'italic' }}>none yet</span>
        )}
      </div>

      {/* Last seen */}
      <div
        style={{
          ...COL_STYLES.lastSeen,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: '#5E5246',
        }}
      >
        {lastSeenLabel(contact.last_seen_at)}
      </div>

      {/* Tracked link (HOR-136) */}
      <div style={{ ...COL_STYLES.link, position: 'relative' }}>
        <TrackedLinkCell
          contactId={contact.id}
          token={contact.tracked_link_token}
          destinationUrl={contact.tracked_link_destination_url}
          lastClickedAt={contact.tracked_link_last_clicked_at}
          appUrl={appUrl}
          defaultLinkUrl={defaultLinkUrl}
        />
      </div>

      {/* Overflow (HOR-137 — Open in new tab / Soft delete) */}
      <div style={{ ...COL_STYLES.overflow, display: 'flex', justifyContent: 'flex-end' }}>
        <RowOverflowMenu
          triggerLabel={name}
          actions={[
            {
              id: 'open-new-tab',
              label: 'Open in new tab',
              Icon: ExternalLink,
              onSelect: () => {
                window.open(`/contacts/${contact.id}`, '_blank', 'noopener')
              },
            },
            {
              id: 'soft-delete',
              label: 'Delete contact',
              Icon: Trash2,
              destructive: true,
              onSelect: async () => {
                if (!window.confirm(`Delete ${name}? You can restore them within 30 days.`)) return
                const res = await fetch(`/api/contacts/${contact.id}`, { method: 'DELETE' })
                if (res.ok) onSoftDelete(contact.id)
              },
            },
          ]}
        />
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
