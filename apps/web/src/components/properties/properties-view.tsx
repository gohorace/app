'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Activity,
  BookmarkPlus,
  ChevronDown,
  Clock,
  List,
  Map,
  MapPin,
  Plus,
  Search,
  Tag,
} from 'lucide-react'
import { RowOverflowMenu, ExternalLink, Trash2 } from '@/components/dashboard/row-overflow-menu'
import {
  AvatarStack,
  EngagementIndicator,
  PropertyThumb,
  StateBadge,
  toneFor,
  type EngagementValue,
  type PropertyStatus,
  type AvatarStackPerson,
} from '@/lib/design/badges'
import { AddPropertyModal } from './add-property-modal'

export interface PropertyGridRow {
  id: string
  address: string
  suburb: string | null
  status: PropertyStatus | null
  /** Bed / bath / land specs — not in current schema; rendered as "—" when null. */
  beds: number | null
  baths: number | null
  land: string | null
  engagement: EngagementValue
  lastActivityAt: string | null
  linkedContacts: AvatarStackPerson[]
  totalLinkedCount: number
}

type Tab = 'all' | 'listed' | 'appraising' | 'watching' | 'sold'

type TimeWindow = 'Active anytime' | 'Today' | 'This week' | 'This month' | 'Ever'
const TIME_WINDOWS: TimeWindow[] = ['Active anytime', 'Today', 'This week', 'This month', 'Ever']

interface SecondaryFilters {
  list:      'All lists'
  intensity: 'Any' | 'High' | 'Medium' | 'Low'
  time:      TimeWindow
  suburb:    string  // 'All suburbs' or a suburb name
}

const DEFAULT_FILTERS: SecondaryFilters = {
  list:      'All lists',
  intensity: 'Any',
  time:      'Active anytime',
  suburb:    'All suburbs',
}

const HOR_137_TIME_WINDOW_MS: Record<Exclude<TimeWindow, 'Active anytime' | 'Ever'>, number> = {
  'Today':      24 * 60 * 60 * 1000,
  'This week':  7  * 24 * 60 * 60 * 1000,
  'This month': 30 * 24 * 60 * 60 * 1000,
}

function passesTimeWindow(lastActivityIso: string | null, window: TimeWindow): boolean {
  if (window === 'Active anytime') return true
  if (window === 'Ever') return Boolean(lastActivityIso)
  if (!lastActivityIso) return false
  const then = new Date(lastActivityIso).getTime()
  if (Number.isNaN(then)) return false
  return Date.now() - then <= HOR_137_TIME_WINDOW_MS[window]
}

interface Props {
  properties: PropertyGridRow[]
  initialQ?: string
  /** When true, the Add Property modal opens on mount (used by /properties/new). */
  defaultModalOpen?: boolean
}

export function PropertiesView({ properties, initialQ = '', defaultModalOpen = false }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState(initialQ)
  const [tab, setTab] = useState<Tab>('all')
  const [filters, setFilters] = useState<SecondaryFilters>(DEFAULT_FILTERS)
  const [addOpen, setAddOpen] = useState(defaultModalOpen)
  // HOR-137: optimistic soft-delete state (mirrors the Contacts grid).
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set())
  const visibleProperties = useMemo(
    () => properties.filter((p) => !deletedIds.has(p.id)),
    [properties, deletedIds],
  )

  const suburbOptions = useMemo(() => {
    const set = new Set<string>()
    for (const p of visibleProperties) if (p.suburb) set.add(p.suburb)
    return ['All suburbs', ...Array.from(set).sort()]
  }, [visibleProperties])

  const tabCounts = useMemo(() => ({
    all:        visibleProperties.length,
    listed:     visibleProperties.filter((p) => p.status === 'listed').length,
    appraising: visibleProperties.filter((p) => p.status === 'appraising').length,
    watching:   visibleProperties.filter((p) => p.status === 'watching').length,
    sold:       visibleProperties.filter((p) => p.status === 'sold').length,
  }), [visibleProperties])

  const filtered = useMemo(() => {
    let rows = visibleProperties

    if (tab === 'listed')          rows = rows.filter((p) => p.status === 'listed')
    else if (tab === 'appraising') rows = rows.filter((p) => p.status === 'appraising')
    else if (tab === 'watching')   rows = rows.filter((p) => p.status === 'watching')
    else if (tab === 'sold')       rows = rows.filter((p) => p.status === 'sold')

    if (filters.intensity !== 'Any') {
      const target = filters.intensity === 'High' ? 3 : filters.intensity === 'Medium' ? 2 : 1
      rows = rows.filter((p) => p.engagement === target)
    }
    if (filters.suburb !== 'All suburbs') {
      rows = rows.filter((p) => p.suburb === filters.suburb)
    }
    // HOR-137: time window filter against last_activity_at
    if (filters.time !== 'Active anytime') {
      rows = rows.filter((p) => passesTimeWindow(p.lastActivityAt, filters.time))
    }

    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter((p) =>
        [p.address, p.suburb].filter(Boolean).join(' ').toLowerCase().includes(q),
      )
    }

    return rows
  }, [visibleProperties, tab, filters, search])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px 80px' }}>
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
                Properties
              </h1>
              <p
                style={{
                  margin: '6px 0 0',
                  fontSize: 13,
                  color: '#8C7B6B',
                  maxWidth: 520,
                  lineHeight: 1.5,
                }}
              >
                Your patch — what&rsquo;s drawing attention, and where the opportunities sit.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              <ViewToggle />
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
                Add property
              </button>
            </div>
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
              <TabButton label="All"        count={tabCounts.all}        active={tab === 'all'}        onClick={() => setTab('all')} />
              <TabButton label="Listed"     count={tabCounts.listed}     active={tab === 'listed'}     onClick={() => setTab('listed')} />
              <TabButton label="Appraising" count={tabCounts.appraising} active={tab === 'appraising'} onClick={() => setTab('appraising')} />
              <TabButton label="Watching"   count={tabCounts.watching}   active={tab === 'watching'}   onClick={() => setTab('watching')} />
              <TabButton label="Sold"       count={tabCounts.sold}       active={tab === 'sold'}       onClick={() => setTab('sold')} />
            </div>

            <div
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
                placeholder="Search address…"
                style={{
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontSize: 12,
                  fontFamily: 'var(--font-body)',
                  color: '#1A1612',
                  width: 180,
                }}
              />
            </div>
          </div>

          {/* Secondary filter chips */}
          <SecondaryFilterBar
            filters={filters}
            suburbOptions={suburbOptions}
            onChange={(next) => setFilters((f) => ({ ...f, ...next }))}
            resultCount={filtered.length}
            totalCount={visibleProperties.length}
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
              <EmptyState onAdd={() => setAddOpen(true)} hasAny={visibleProperties.length > 0} search={search} />
            ) : (
              filtered.map((p, idx) => (
                <PropertyRow
                  key={p.id}
                  property={p}
                  isLast={idx === filtered.length - 1}
                  onSoftDelete={(id) => setDeletedIds((prev) => {
                    const next = new Set(prev)
                    next.add(id)
                    return next
                  })}
                  onClick={() => router.push(`/properties/${p.id}`)}
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
            }}
          >
            Your relationships, your history. The property is shared — your view of it is sovereign.
          </p>
        </div>
      </div>

      {addOpen && (
        <AddPropertyModal
          onClose={() => setAddOpen(false)}
          onComplete={(id) => {
            setAddOpen(false)
            router.push(`/properties/${id}`)
          }}
        />
      )}
    </div>
  )
}

// ── View toggle (List | Map) ─────────────────────────────────────────────────

function ViewToggle() {
  return (
    <div
      style={{
        display: 'inline-flex',
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.22)',
        borderRadius: 7,
        padding: 2,
      }}
    >
      <button
        type="button"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '6px 11px',
          borderRadius: 5,
          background: '#1A1612',
          color: '#FAF7F2',
          fontSize: 12,
          fontWeight: 500,
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'var(--font-body)',
        }}
      >
        <List style={{ width: 13, height: 13 }} />
        List
      </button>
      <button
        type="button"
        disabled
        title="Map view coming soon"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '6px 11px',
          borderRadius: 5,
          background: 'transparent',
          color: '#8C7B6B',
          fontSize: 12,
          fontWeight: 500,
          border: 'none',
          cursor: 'not-allowed',
          fontFamily: 'var(--font-body)',
        }}
      >
        <Map style={{ width: 13, height: 13 }} />
        Map
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            background: 'rgba(140,123,107,0.18)',
            color: '#8C7B6B',
            padding: '1px 5px',
            borderRadius: 3,
            marginLeft: 3,
          }}
        >
          soon
        </span>
      </button>
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

function FilterChip({
  label,
  Icon,
  isActive,
  current,
  options,
  onSelect,
  disabledTooltip,
}: {
  label: string
  Icon: typeof Tag
  isActive: boolean
  current: string
  options: string[]
  onSelect: (v: string) => void
  disabledTooltip?: string
}) {
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
              maxHeight: 280,
              overflowY: 'auto',
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
  suburbOptions,
  onChange,
  resultCount,
  totalCount,
}: {
  filters: SecondaryFilters
  suburbOptions: string[]
  onChange: (next: Partial<SecondaryFilters>) => void
  resultCount: number
  totalCount: number
}) {
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
        label="Suburb"
        Icon={MapPin}
        isActive={filters.suburb !== 'All suburbs'}
        current={filters.suburb}
        options={suburbOptions}
        onSelect={(v) => onChange({ suburb: v })}
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

// ── Table head + row ─────────────────────────────────────────────────────────

const COL = {
  thumb:      { width: 52, flexGrow: 0, flexShrink: 0 },
  property:   { flex: 2.4, minWidth: 180 },
  state:      { flex: 1.1, minWidth: 110 },
  specs:      { flex: 1,   minWidth: 110 },
  engagement: { flex: 1.1, minWidth: 120 },
  contacts:   { flex: 1.5, minWidth: 130 },
  lastSeen:   { flex: 0.9, minWidth: 80 },
  overflow:   { width: 36, flexGrow: 0, flexShrink: 0 },
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
      <span style={COL.thumb} />
      <span style={COL.property}>Property</span>
      <span style={COL.state}>State</span>
      <span style={COL.specs}>Specs</span>
      <span style={COL.engagement}>Engagement</span>
      <span style={COL.contacts}>Known contacts</span>
      <span style={COL.lastSeen}>Last seen</span>
      <span style={COL.overflow} />
    </div>
  )
}

function PropertyRow({
  property,
  isLast,
  onClick,
  onSoftDelete,
}: {
  property: PropertyGridRow
  isLast: boolean
  onClick: () => void
  onSoftDelete: (id: string) => void
}) {
  const tone = toneFor(property.id)
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
      <div style={COL.thumb}>
        <PropertyThumb tone={tone} address={property.address} size={44} />
      </div>

      <div style={{ ...COL.property, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: '#1A1612',
            marginBottom: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {property.address}
        </div>
        <div style={{ fontSize: 12, color: '#8C7B6B' }}>{property.suburb ?? '—'}</div>
      </div>

      <div style={COL.state}>
        <StateBadge status={property.status} />
      </div>

      <div
        style={{
          ...COL.specs,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: '#5E5246',
        }}
      >
        <span>
          <strong style={{ color: '#1A1612', fontWeight: 600 }}>{property.beds ?? '—'}</strong> bd
        </span>
        <span style={{ color: 'rgba(140,123,107,0.4)' }}>·</span>
        <span>
          <strong style={{ color: '#1A1612', fontWeight: 600 }}>{property.baths ?? '—'}</strong> ba
        </span>
        <span style={{ color: 'rgba(140,123,107,0.4)' }}>·</span>
        <span>{property.land ?? '—'}</span>
      </div>

      <div style={{ ...COL.engagement, display: 'flex', alignItems: 'center' }}>
        <EngagementIndicator value={property.engagement} showLabel />
      </div>

      <div style={{ ...COL.contacts, display: 'flex', alignItems: 'center', gap: 10 }}>
        {property.totalLinkedCount > 0 ? (
          <>
            <AvatarStack people={property.linkedContacts} />
            <span style={{ fontSize: 12, color: '#5E5246' }}>
              {property.totalLinkedCount} known
            </span>
          </>
        ) : (
          <span style={{ fontSize: 12, color: '#8C7B6B', fontStyle: 'italic' }}>
            anonymous only
          </span>
        )}
      </div>

      <div
        style={{
          ...COL.lastSeen,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: '#5E5246',
        }}
      >
        {relativeWhen(property.lastActivityAt)}
      </div>

      {/* Overflow (HOR-137 — Open in new tab / Soft delete) */}
      <div style={{ ...COL.overflow, display: 'flex', justifyContent: 'flex-end' }}>
        <RowOverflowMenu
          triggerLabel={property.address}
          actions={[
            {
              id: 'open-new-tab',
              label: 'Open in new tab',
              Icon: ExternalLink,
              onSelect: () => {
                window.open(`/properties/${property.id}`, '_blank', 'noopener')
              },
            },
            {
              id: 'soft-delete',
              label: 'Delete property',
              Icon: Trash2,
              destructive: true,
              onSelect: async () => {
                if (!window.confirm(
                  `Delete ${property.address}? Soft delete — restorable later.`,
                )) return
                const res = await fetch(`/api/properties/${property.id}`, { method: 'DELETE' })
                if (res.ok) onSoftDelete(property.id)
              },
            },
          ]}
        />
      </div>
    </div>
  )
}

function EmptyState({
  onAdd,
  hasAny,
  search,
}: {
  onAdd: () => void
  hasAny: boolean
  search: string
}) {
  // Two-line empty-state pattern: acknowledge the quiet + what Horace does next.
  const line1 = search
    ? `Nothing matches "${search}" yet.`
    : !hasAny
      ? 'Your patch is empty so far.'
      : 'Nothing matches this view yet.'
  const line2 = search
    ? 'Try a different search, or add a property.'
    : !hasAny
      ? 'Add the addresses you want signals on — Horace fills in the rest.'
      : 'Adjust filters above, or add a property.'

  return (
    <div style={{ padding: '48px 24px', textAlign: 'center', background: '#FAF7F2' }}>
      <p style={{ fontSize: 13, fontWeight: 500, color: '#5E5246', marginBottom: 6 }}>
        {line1}
      </p>
      <p style={{ fontSize: 12, color: '#8C7B6B', marginBottom: !hasAny && !search ? 18 : 0 }}>
        {line2}
      </p>
      {!search && !hasAny && (
        <>
          <button
            type="button"
            onClick={onAdd}
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
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
            }}
          >
            <Plus style={{ width: 14, height: 14 }} />
            Add property
          </button>
        </>
      )}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeWhen(iso: string | null): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  const d = Math.floor(diff / 86_400_000)
  if (d === 1) return 'Yesterday'
  if (d < 7) return `${d}d ago`
  const w = Math.floor(d / 7)
  if (w < 4) return `${w}w ago`
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
