'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Activity,
  BookmarkPlus,
  ChevronDown,
  Clock,
  Link2,
  List,
  // HOR-220: aliased to avoid shadowing the global `Map` constructor we use
  // in the suburbStatesByName memo below.
  Map as MapIcon,
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
import Link from 'next/link'
import { AddPropertyModal } from './add-property-modal'
import { EmptyNoCoreMarket } from './empty-no-core-market'
import { MAP_COPY } from '@/lib/copy/map-view'
import type {
  MapPayload,
  SuburbState,
  TimeWindow as MapTimeWindow,
} from '@/lib/map/rpc-types'

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
  /** HOR-195: lat/lng for the map view. Null when unavailable (pre-G-NAF rows). */
  latitude:  number | null
  longitude: number | null
  /** HOR-195: full names of linked contacts so search can match by person. */
  linkedContactNames: string[]
  /** HOR-195: street_name for the street-prefix filter. */
  streetName: string | null
}

/** HOR-195: per-agent core_markets row, passed in from the server page. */
export interface CoreMarketSummary {
  id:            string
  locality_pid:  string
  locality_name: string
  state_abbrev:  string
  /** Optional centre — used by the map view as a fallback if no plottable properties. */
  latitude:      number | null
  longitude:     number | null
}

type Tab = 'all' | 'listed' | 'appraising' | 'watching' | 'sold'

type TimeWindow = 'Active anytime' | 'Today' | 'This week' | 'This month' | 'Ever'
const TIME_WINDOWS: TimeWindow[] = ['Active anytime', 'Today', 'This week', 'This month', 'Ever']

type LinkedFilter = 'All' | 'Linked' | 'Unlinked'
const LINKED_OPTIONS: LinkedFilter[] = ['All', 'Linked', 'Unlinked']

interface SecondaryFilters {
  list:      'All lists'
  intensity: 'Any' | 'High' | 'Medium' | 'Low'
  time:      TimeWindow
  suburb:    string  // 'All suburbs' or a suburb name
  /** HOR-195: street name prefix filter (case-insensitive). */
  street:    string
  /** HOR-195: linked-contact presence filter. */
  linked:    LinkedFilter
}

const DEFAULT_FILTERS: SecondaryFilters = {
  list:      'All lists',
  intensity: 'Any',
  time:      'Active anytime',
  suburb:    'All suburbs',
  street:    '',
  linked:    'All',
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
  /** HOR-195: current agent's active core markets. Empty → full-screen empty state. */
  coreMarkets?: CoreMarketSummary[]
  /**
   * HOR-217: time window for the map view's signal payload + the list's
   * engagement column. Mirrors `?timeWindow=` on the URL; the scrubber updates
   * both the URL and the local fetch. Defaults to `7d` server-side.
   */
  initialTimeWindow?: MapTimeWindow
}

export function PropertiesView({
  properties,
  initialQ = '',
  defaultModalOpen = false,
  coreMarkets = [],
  initialTimeWindow = '7d',
}: Props) {
  const router = useRouter()
  const [search, setSearch] = useState(initialQ)
  const [tab, setTab] = useState<Tab>('all')
  const [filters, setFilters] = useState<SecondaryFilters>(DEFAULT_FILTERS)
  const [addOpen, setAddOpen] = useState(defaultModalOpen)
  // HOR-217: scrubber time window + map payload. The scrubber is only mounted
  // when view==='map' (HOR-220 mirrors the chrome onto list view), so the
  // fetch only fires when the agent is looking at the map. `mapLoading` drives
  // the parchment-desaturation hint during refetch — no spinner, per brief.
  const [timeWindow, setTimeWindow] = useState<MapTimeWindow>(initialTimeWindow)
  const [mapPayload, setMapPayload] = useState<MapPayload | null>(null)
  const [mapLoading, setMapLoading] = useState(false)
  // Debounce + abort handling so a rapid run of scrubber clicks coalesces to
  // a single in-flight fetch. The previous attempt is aborted; the latest wins.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchAbortRef = useRef<AbortController | null>(null)
  // HOR-137: optimistic soft-delete state (mirrors the Contacts grid).
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set())
  const visibleProperties = useMemo(
    () => properties.filter((p) => !deletedIds.has(p.id)),
    [properties, deletedIds],
  )

  // HOR-220: index suburb state by lower-cased name so the list-view row can
  // surface the suburb's signal tier inline. Keys match `properties.suburb`
  // case-insensitively (server keeps the canonical name; properties may have
  // legacy capitalisation).
  //
  // Hotfix: skip suburbs with null `name` — legacy `properties.suburb = NULL`
  // rows can yield a suburb signal with a null name through the RPC's
  // coalesce fallback. Skipping is safe because the list-view row's pill
  // can't be matched to a null suburb anyway.
  const suburbStatesByName = useMemo(() => {
    const m = new Map<string, SuburbState>()
    for (const s of mapPayload?.suburbs ?? []) {
      if (!s.name) continue
      m.set(s.name.toLowerCase(), s.state)
    }
    return m
  }, [mapPayload?.suburbs])

  // ─── HOR-217 + HOR-220: Map payload fetch ──────────────────────────────────
  //
  // Fires on mount and on scrubber change. Debounced 250ms; aborts any
  // in-flight prior request so a fast click-through doesn't pile responses
  // on top of each other.
  //
  // HOR-220 lifted the `view === 'map'` gate — the List view now consumes
  // the same payload (Horace summary, counter row, per-row suburb-signal
  // pill). Single source of truth across both presentations.

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(() => {
      if (fetchAbortRef.current) fetchAbortRef.current.abort()
      const controller = new AbortController()
      fetchAbortRef.current = controller

      setMapLoading(true)
      fetch(`/api/properties/map-payload?timeWindow=${timeWindow}`, {
        signal: controller.signal,
        // No cache — Haiku summary is server-cached for 1h; the route itself
        // is cheap to refetch on each scrubber click.
        cache: 'no-store',
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((payload: MapPayload) => {
          if (controller.signal.aborted) return
          setMapPayload(payload)
        })
        .catch((err) => {
          if (controller.signal.aborted) return
          console.error('[properties-view] map-payload fetch failed:', err)
        })
        .finally(() => {
          if (controller.signal.aborted) return
          setMapLoading(false)
        })
    }, 250)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [timeWindow])

  // ─── HOR-217: URL sync for the time window ────────────────────────────────
  //
  // Use `history.replaceState` rather than `router.replace` so the change
  // doesn't trigger a Next.js navigation/re-render. Reload still picks up the
  // value via the server page; navigating away preserves it.

  const handleScrubberChange = (next: MapTimeWindow) => {
    setTimeWindow(next)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('timeWindow', next)
      window.history.replaceState(null, '', url.toString())
    }
  }

  // HOR-195: brief — "If agent has no core market set, Properties screen
  // shows a primary empty state (not a dismissible banner). Single CTA
  // opens the suburb picker. Disappears once at least one core market is
  // set. Returns if agent removes their last core market."
  // Branch happens in the JSX below to keep hook order stable across renders.
  const noMarkets = coreMarkets.length === 0

  // HOR-195: suburb dropdown source — union of agent's core_markets
  // localities (so they're selectable even before imports populate
  // properties) AND any other suburbs already present on properties
  // (legacy CSV imports, listing scrapes).
  const suburbOptions = useMemo(() => {
    const set = new Set<string>()
    for (const m of coreMarkets) set.add(m.locality_name)
    for (const p of visibleProperties) if (p.suburb) set.add(p.suburb)
    return ['All suburbs', ...Array.from(set).sort()]
  }, [coreMarkets, visibleProperties])

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
    // HOR-195: street-name prefix filter (case-insensitive). Empty string = no-op.
    const streetPrefix = filters.street.trim().toLowerCase()
    if (streetPrefix) {
      rows = rows.filter((p) =>
        (p.streetName ?? '').toLowerCase().startsWith(streetPrefix),
      )
    }
    // HOR-195: linked / unlinked toggle. "Linked" = at least one
    // contact-property reference (residence_property_id or any
    // contact_property_relationships row, both surfaced in
    // totalLinkedCount by the server page).
    if (filters.linked === 'Linked') {
      rows = rows.filter((p) => p.totalLinkedCount > 0)
    } else if (filters.linked === 'Unlinked') {
      rows = rows.filter((p) => p.totalLinkedCount === 0)
    }

    const q = search.trim().toLowerCase()
    if (q) {
      // HOR-195: search widens to include linked contact names so an
      // agent can find a property by its resident's name.
      rows = rows.filter((p) => {
        const hay = [
          p.address,
          p.suburb,
          ...p.linkedContactNames,
        ].filter(Boolean).join(' ').toLowerCase()
        return hay.includes(q)
      })
    }

    return rows
  }, [visibleProperties, tab, filters, search])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {noMarkets ? (
        <EmptyNoCoreMarket />
      ) : (
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
                {/* HOR-217: subtitle moved into the Horace-voice locale.
                    Same string for both views — the brief treats Properties
                    as a single surface with two presentations. */}
                {MAP_COPY.headerSubtitle}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              {/* HOR-245 — v2 drops the in-page Map toggle in favour of the
                * dedicated /market route. This is a navigation link, not a
                * view-mode switch. */}
              <Link
                href="/market"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  borderRadius: 7,
                  background: '#FAF7F2',
                  color: '#5E5246',
                  fontSize: 13,
                  fontWeight: 500,
                  border: '1px solid rgba(140,123,107,0.3)',
                  cursor: 'pointer',
                  textDecoration: 'none',
                  fontFamily: 'var(--font-body)',
                }}
              >
                <MapIcon style={{ width: 14, height: 14 }} aria-hidden />
                See on map
              </Link>
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

          {/* HOR-217 + HOR-220: Horace strip — voice summary + signal counter row.
              Mirrored across both views per the brief's "List view is the
              accessible equivalent" requirement. The chrome stays identical
              so a keyboard-only agent reads the same intelligence the map
              renders visually. */}
          <HoraceStrip payload={mapPayload} loading={mapLoading} />

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

          {/* HOR-245: v2 drops the in-page Map view — `/market` is now the
            * dedicated route. The list view is the only content here.
            * mapPayload still flows in (HoraceStrip + per-row suburb pill);
            * the time scrubber moves to /market (v2-M6 will add a
            * suggestion strip in its place if needed). */}
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
                  suburbState={suburbStatesByName.get((p.suburb ?? '').toLowerCase()) ?? null}
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
      )}

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

// ── Horace strip (HOR-217) ───────────────────────────────────────────────────
// Sits below the page header on the map view. Three things in one row:
//   1. The Horace voice line — italic Playfair sentence prefixed by `• HORACE`.
//   2. (right) The counter chip row — `7 warm · 12 active · 4 stirring`.
//
// Pre-payload state: a quiet placeholder line + dashed counters. We don't fall
// back to fake counts; better to look mid-render than to lie.

function HoraceStrip({
  payload,
  loading,
}: {
  payload: MapPayload | null
  loading: boolean
}) {
  const hasPayload = payload !== null
  const counters = payload?.counters ?? { warm: 0, active: 0, stirring: 0 }
  // Empty state copy when the workspace has no signal at all in the window.
  const totalSignal = counters.warm + counters.active + counters.stirring
  const summary =
    hasPayload
      ? (payload!.summary || (totalSignal === 0 ? MAP_COPY.emptyState : ''))
      : ''

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        marginBottom: 18,
        padding: '12px 14px',
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.18)',
        borderRadius: 8,
        opacity: loading ? 0.78 : 1,
        transition: 'opacity 180ms ease-out',
      }}
    >
      {/* Horace voice */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#C4622D',
            marginTop: 6,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.12em',
            color: '#8C7B6B',
            marginTop: 4,
            flexShrink: 0,
          }}
        >
          {MAP_COPY.horaceTag}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontSize: 14.5,
            lineHeight: 1.45,
            color: '#1A1612',
            letterSpacing: '-0.005em',
          }}
        >
          {summary || (hasPayload ? ' ' : '…')}
        </span>
      </div>

      {/* Counter row — mixed units per design (warm/stirring are suburbs,
          active is properties). Each chip is monospaced number + lowercase
          label, no pluralisation logic per the Horace copy rule. */}
      <div style={{ display: 'flex', gap: 18, flexShrink: 0 }}>
        <CounterChip value={counters.warm}     label={MAP_COPY.counterLabels.warm}     />
        <CounterChip value={counters.active}   label={MAP_COPY.counterLabels.active}   />
        <CounterChip value={counters.stirring} label={MAP_COPY.counterLabels.stirring} />
      </div>
    </div>
  )
}

function CounterChip({ value, label }: { value: number; label: string }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 18,
          fontWeight: 600,
          color: '#1A1612',
          letterSpacing: '-0.01em',
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: 12, color: '#8C7B6B' }}>{label}</span>
    </div>
  )
}

// ── Suburb signal pill (HOR-220 — inline in the list-view row's suburb cell) ──
// Same vocabulary as the map's suburb labels: warm = cream, hot = terracotta,
// stirring = orange ring. Colour AND treatment differ — the ring on stirring
// is the non-colour-only signal carrier per WCAG 1.4.1.

function SuburbSignalPill({ state }: { state: SuburbState }) {
  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '1px 6px',
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    borderRadius: 9999,
    flexShrink: 0,
  }
  if (state === 'hot') {
    style.background = 'rgba(196,98,45,0.16)'
    style.color = '#C4622D'
    style.border = '1px solid rgba(196,98,45,0.32)'
  } else if (state === 'warm') {
    style.background = 'rgba(196,98,45,0.06)'
    style.color = '#8C5A35'
    style.border = '1px solid rgba(196,98,45,0.18)'
  } else if (state === 'stirring') {
    style.background = 'transparent'
    style.color = '#C4622D'
    // Ring treatment — non-colour-only signal carrier.
    style.border = '1px solid #C4622D'
    style.boxShadow = '0 0 0 2px rgba(196,98,45,0.18)'
  } else {
    return null
  }
  return (
    <span style={style} aria-label={`suburb ${state}`}>
      {state}
    </span>
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

// HOR-195: street-name prefix typeahead chip. Renders inline as a
// chip-shaped text input — no dropdown, just a filter-as-you-type
// since street values are open-set.
function StreetFilterInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const active = value.trim().length > 0
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 11px',
        borderRadius: 6,
        fontSize: 11.5,
        fontWeight: 500,
        background: active ? 'rgba(196,98,45,0.08)' : '#FAF7F2',
        color: active ? '#C4622D' : '#5E5246',
        border: `1px solid ${active ? 'rgba(196,98,45,0.25)' : 'rgba(140,123,107,0.22)'}`,
        fontFamily: 'var(--font-body)',
      }}
    >
      <MapPin style={{ width: 11, height: 11, opacity: 0.7 }} />
      Street:
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Any"
        style={{
          background: 'transparent',
          border: 'none',
          outline: 'none',
          fontSize: 11.5,
          fontFamily: 'var(--font-body)',
          color: active ? '#C4622D' : '#1A1612',
          width: 90,
        }}
      />
      {active && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear street filter"
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1,
            color: '#C4622D',
            opacity: 0.6,
          }}
        >
          ×
        </button>
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
      {/* HOR-195: linked / unlinked toggle */}
      <FilterChip
        label="Contacts"
        Icon={Link2}
        isActive={filters.linked !== 'All'}
        current={filters.linked}
        options={LINKED_OPTIONS as unknown as string[]}
        onSelect={(v) => onChange({ linked: v as LinkedFilter })}
      />
      {/* HOR-195: street-name prefix typeahead. Keeps the chip layout
          consistent but uses an inline input instead of a dropdown
          because street values are open-set. */}
      <StreetFilterInput
        value={filters.street}
        onChange={(v) => onChange({ street: v })}
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
  suburbState,
  isLast,
  onClick,
  onSoftDelete,
}: {
  property: PropertyGridRow
  /** HOR-220: tier of the property's suburb on the map view. Renders as
   *  a small pill next to the suburb name. Null when no signal data has
   *  loaded yet or the property's suburb isn't in the payload. */
  suburbState: SuburbState | null
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
        <div style={{ fontSize: 12, color: '#8C7B6B', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{property.suburb ?? '—'}</span>
          {suburbState && suburbState !== 'quiet' && (
            <SuburbSignalPill state={suburbState} />
          )}
        </div>
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
