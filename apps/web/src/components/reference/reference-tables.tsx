'use client'

/* Horace — Reference tables (substrate layer).
 *
 * The raw, read-only "infrastructure, not UI" view of contacts + properties —
 * a Supabase-Studio-style vessel for the behavioural data. Ported pixel-exact
 * from the design handoff prototype (tables.jsx + app.jsx). The three resolved
 * design toggles are locked to their recommended production defaults:
 *   signal = pills · id = truncated + copy-on-click · checkboxes = off · density = regular
 *
 * Read-only by design: sort, filter, range-pagination, and opening a row are
 * the only affordances. No insert / edit / delete, no write-back.
 *
 * DATA INTERFACE (UI-first phase): rows arrive as props (`ContactRow[]` /
 * `PropertyRow[]`) and sort / filter / pagination run client-side here. To
 * wire real data, supply server-paginated rows + a total count and move the
 * sort/filter/slice into the query (marked below). */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import styles from './substrate.module.css'
import {
  SIGNALS,
  SIGNAL_STYLES,
  SIGNAL_ORDER,
  type SignalValue,
  type ContactRow,
  type PropertyRow,
} from './types'

// ── Tabler-style inline icons (stroke, 1.75) ──────────────────────────
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}
type SvgProps = React.SVGProps<SVGSVGElement> & { s?: number }
const Svg = ({ s = 16, children, ...p }: SvgProps) => (
  <svg width={s} height={s} viewBox="0 0 24 24" {...stroke} {...p}>{children}</svg>
)
const IconTable = (p: SvgProps) => (<Svg {...p}><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M3 10h18M10 3v18" /></Svg>)
const IconFilter = (p: SvgProps) => (<Svg {...p}><path d="M4 4h16v2.172a2 2 0 0 1-.586 1.414L15 12v7l-6 2v-8.5L4.52 7.59A2 2 0 0 1 4 6.236z" /></Svg>)
const IconSort = (p: SvgProps) => (<Svg {...p}><path d="M3 9l4-4 4 4M7 5v14M21 15l-4 4-4-4M17 5v14" /></Svg>)
const IconChevL = (p: SvgProps) => (<Svg {...p}><path d="M15 6l-6 6 6 6" /></Svg>)
const IconChevR = (p: SvgProps) => (<Svg {...p}><path d="M9 6l6 6-6 6" /></Svg>)
const IconX = (p: SvgProps) => (<Svg {...p}><path d="M18 6L6 18M6 6l12 12" /></Svg>)
const IconOpen = (p: SvgProps) => (<Svg {...p}><path d="M7 17L17 7M8 7h9v9" /></Svg>)
const IconSearch = (p: SvgProps) => (<Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></Svg>)
const CaretUp = (p: SvgProps) => (<Svg s={11} {...p}><path d="M6 15l6-6 6 6" /></Svg>)
const CaretDown = (p: SvgProps) => (<Svg s={11} {...p}><path d="M6 9l6 6 6-6" /></Svg>)

const num = (n: number) => n.toLocaleString('en-US')

// ── signal pill (self-contained, light fill + dark text; theme-independent) ──
function Signal({ value }: { value: SignalValue }) {
  const s = SIGNAL_STYLES[value] ?? SIGNAL_STYLES.watching
  return <span className={styles.pill} style={{ background: s.fill, color: s.text }}>{value}</span>
}

// ── null literal (real absence, screen-reader clarified) ──────────────
const NullCell = ({ field }: { field: string }) => (
  <span className={styles.vNull} aria-label={`${field}: no value`}>null</span>
)

// ── id cell (truncated first8… + copy-the-full-uuid on click) ─────────
function IdCell({ id }: { id: string }) {
  const [copied, setCopied] = React.useState(false)
  const onCopy = (e: React.MouseEvent) => {
    e.stopPropagation() // copy, don't open the row
    try { navigator.clipboard?.writeText(id) } catch { /* clipboard unavailable */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 900)
  }
  return (
    <span className={`${styles.vId} ${styles.copyable}`} title={`${id}  ·  click to copy`} onClick={onCopy}>
      {copied
        ? <span className={styles.copied}>copied</span>
        : <>{id.slice(0, 8)}<span style={{ opacity: 0.5 }}>…</span></>}
    </span>
  )
}

// ── filter dropdown (signal enum) ─────────────────────────────────────
function FilterDrop({
  field, options, selected, onToggle, onClear, onClose,
}: {
  field: string
  options: SignalValue[]
  selected: SignalValue[]
  onToggle: (o: SignalValue) => void
  onClear: () => void
  onClose: () => void
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])
  return (
    <div className={styles.fdrop} ref={ref} role="dialog" aria-label={`filter ${field}`}>
      <div className={styles.fdropLabel}>{field} =</div>
      {options.map((o) => (
        <label key={o} className={styles.fopt}>
          <input type="checkbox" checked={selected.includes(o)} onChange={() => onToggle(o)} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: SIGNAL_STYLES[o]?.text }} />
            {o}
          </span>
        </label>
      ))}
      <div className={styles.fdropFoot}>
        <span className={styles.fdropActive}>{selected.length || 'no'} active</span>
        <button className={styles.fdropClear} onClick={onClear}>clear</button>
      </div>
    </div>
  )
}

// ── primary-text cell: value + reserved "open" affordance (right-aligned) ──
const OpenTag = ({ children }: { children: React.ReactNode }) => (
  <span className={styles.namecell}>
    <span className={`${styles.vSans} ${styles.nametext}`}>{children}</span>
    <span className={styles.open}>open <IconOpen s={12} /></span>
  </span>
)

// ── column model ──────────────────────────────────────────────────────
interface Column<T> {
  key: string
  type: string
  w: number
  num?: boolean
  skelW?: string
  defaultSort?: boolean
  sortVal: (r: T) => string | number | null
  title?: (r: T) => string
  render: (r: T) => React.ReactNode
}

type SortState = { key: string; dir: 'asc' | 'desc' }
const PAGE = 50

// ── generic table block ───────────────────────────────────────────────
function TableBlock<T extends { id: string }>({
  table, name, columns, rows, signalKey, signalOf, searchOf, searchPlaceholder, onOpen,
}: {
  table: string
  name: string
  columns: Column<T>[]
  rows: T[]
  signalKey: string
  signalOf: (r: T) => SignalValue
  /** Returns the searchable text for a row (matched case-insensitively against
   *  the query). Omit to hide the search affordance. */
  searchOf?: (r: T) => string
  searchPlaceholder?: string
  onOpen: (row: T) => void
}) {
  const [sort, setSort] = React.useState<SortState>({
    key: columns.find((c) => c.defaultSort)?.key ?? columns[0].key,
    dir: 'desc',
  })
  const [page, setPage] = React.useState(0)
  const [filters, setFilters] = React.useState<SignalValue[]>([])
  const [filterOpen, setFilterOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    const t = setTimeout(() => setLoading(false), 620 + (table === 'properties' ? 220 : 0))
    return () => clearTimeout(t)
  }, [table])

  const col = (k: string) => columns.find((c) => c.key === k)!

  // ── client-side search / sort / filter / paginate (replace with server
  //    query params when wiring real data) ─────────────────────────────
  const searched = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !searchOf) return rows
    return rows.filter((r) => searchOf(r).toLowerCase().includes(q))
  }, [rows, query, searchOf])

  const filtered = React.useMemo(() => {
    if (filters.length === 0) return searched
    return searched.filter((r) => filters.includes(signalOf(r)))
  }, [searched, filters, signalOf])

  const sorted = React.useMemo(() => {
    const sv = col(sort.key).sortVal
    const arr = [...filtered].sort((a, b) => {
      const va = sv(a), vb = sv(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (va < vb) return -1
      if (va > vb) return 1
      return 0
    })
    if (sort.dir === 'desc') arr.reverse()
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort])

  const total = sorted.length
  const pageCount = Math.max(1, Math.ceil(total / PAGE))
  const safePage = Math.min(page, pageCount - 1)
  const start = safePage * PAGE
  const visible = sorted.slice(start, start + PAGE)
  const from = total === 0 ? 0 : start + 1
  const to = Math.min(start + PAGE, total)

  const onSort = (key: string) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
    setPage(0)
  }
  const toggleFilter = (o: SignalValue) => {
    setFilters((f) => (f.includes(o) ? f.filter((x) => x !== o) : [...f, o]))
    setPage(0)
  }
  const clearFilter = () => { setFilters([]); setPage(0) }
  const onQueryChange = (v: string) => { setQuery(v); setPage(0) }

  const minWidth = columns.reduce((a, c) => a + c.w, 0)

  return (
    <section className={styles.block} aria-labelledby={`ref-h-${table}`}>
      <h2 className={styles.vh} id={`ref-h-${table}`}>{name} — {rows.length} rows</h2>

      {/* header bar */}
      <div className={styles.bar}>
        <span className={styles.barName}><IconTable s={15} /> {name}</span>
        <span className={styles.barCount}>{num(rows.length)} rows</span>
        <div className={styles.chips}>
          <div style={{ position: 'relative' }}>
            <button
              className={styles.chip}
              data-on={filters.length > 0 || filterOpen}
              onClick={() => setFilterOpen((o) => !o)}
            >
              <IconFilter s={13} />
              {filters.length > 0 ? <>{signalKey} <b>{filters.length}</b></> : 'filter'}
              {filters.length > 0 && (
                <span
                  className={styles.chipX}
                  onClick={(e) => { e.stopPropagation(); clearFilter() }}
                ><IconX s={12} /></span>
              )}
            </button>
            {filterOpen && (
              <FilterDrop
                field={signalKey}
                options={SIGNALS}
                selected={filters}
                onToggle={toggleFilter}
                onClear={clearFilter}
                onClose={() => setFilterOpen(false)}
              />
            )}
          </div>
          <button
            className={styles.chip}
            data-on={true}
            onClick={() => onSort(sort.key)}
            title="toggle sort direction"
          >
            <IconSort s={13} /> {sort.key} <b>{sort.dir === 'asc' ? '↑' : '↓'}</b>
          </button>
        </div>
        {searchOf && (
          <div className={styles.search} data-on={query.length > 0}>
            <IconSearch s={13} />
            <input
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={searchPlaceholder ?? `search ${name}`}
              aria-label={`search ${name}`}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
            {query && (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => onQueryChange('')}
                aria-label="clear search"
              ><IconX s={12} /></button>
            )}
          </div>
        )}
      </div>

      {/* grid */}
      <div className={styles.gridScroll}>
        <table className={styles.grid} style={{ minWidth }}>
          <colgroup>
            {columns.map((c) => <col key={c.key} style={{ width: c.w }} />)}
          </colgroup>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort.key === c.key
                const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                return (
                  <th key={c.key} scope="col" className={c.num ? styles.num : undefined} aria-sort={ariaSort}>
                    <button
                      className={styles.colhead}
                      onClick={() => onSort(c.key)}
                      aria-label={`sort by ${c.key}${active ? ', currently ' + ariaSort : ''}`}
                    >
                      <span className={styles.colname}>{c.key}</span>
                      <span className={styles.coltype}>{c.type}</span>
                      <span className={styles.caret}>
                        {active && sort.dir === 'asc' ? <CaretUp /> : <CaretDown />}
                      </span>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 12 }).map((_, i) => (
                <tr className={styles.skelRow} key={i} style={{ animationDelay: `${(i % 6) * 70}ms` }}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.num ? styles.num : undefined}>
                      <span className={styles.skelBar} style={{ width: c.skelW ?? '60%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : visible.length === 0 ? (
              <tr className={styles.norows}><td colSpan={columns.length}>no rows</td></tr>
            ) : (
              visible.map((r) => (
                <tr
                  key={r.id}
                  className={styles.row}
                  tabIndex={0}
                  role="button"
                  aria-label={`open ${table.replace(/s$/, '')} ${r.id.slice(0, 8)}`}
                  onClick={() => onOpen(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(r) }
                  }}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={c.num ? styles.num : undefined} title={c.title?.(r)}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* footer bar — range pagination */}
      <div className={styles.foot}>
        <span className={styles.range}>
          {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
        </span>
        <button
          className={styles.pager}
          aria-label="previous page"
          disabled={safePage === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        ><IconChevL s={14} /></button>
        <button
          className={styles.pager}
          aria-label="next page"
          disabled={safePage >= pageCount - 1}
          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
        ><IconChevR s={14} /></button>
      </div>
    </section>
  )
}

// ── column definitions ────────────────────────────────────────────────
const CONTACT_COLUMNS: Column<ContactRow>[] = [
  { key: 'id', type: 'uuid', w: 132, skelW: '52%', sortVal: (r) => r.id, render: (r) => <IdCell id={r.id} /> },
  { key: 'name', type: 'text', w: 220, skelW: '68%', title: (r) => r.name,
    sortVal: (r) => r.name.toLowerCase(), render: (r) => <OpenTag>{r.name}</OpenTag> },
  { key: 'email', type: 'text', w: 232, skelW: '76%', title: (r) => r.email ?? 'null',
    sortVal: (r) => (r.email ? r.email.toLowerCase() : null),
    render: (r) => (r.email ? <span className={styles.vSecondary}>{r.email}</span> : <NullCell field="email" />) },
  { key: 'intent', type: 'int2', w: 116, num: true, skelW: '38%', sortVal: (r) => r.intent, render: (r) => r.intent },
  { key: 'signal', type: 'enum', w: 134, skelW: '70%',
    sortVal: (r) => SIGNAL_ORDER[r.signal], render: (r) => <Signal value={r.signal} /> },
  { key: 'sessions_7d', type: 'int2', w: 156, num: true, skelW: '34%',
    sortVal: (r) => r.sessions_7d, render: (r) => r.sessions_7d },
  { key: 'last_seen', type: 'timestamptz', w: 190, skelW: '88%', defaultSort: true,
    sortVal: (r) => r.last_seen, title: (r) => r.last_seen ?? 'null',
    render: (r) => (r.last_seen ? <span className={styles.vTs}>{r.last_seen}</span> : <NullCell field="last_seen" />) },
]

const PROPERTY_COLUMNS: Column<PropertyRow>[] = [
  { key: 'id', type: 'uuid', w: 132, skelW: '52%', sortVal: (r) => r.id, render: (r) => <IdCell id={r.id} /> },
  { key: 'address', type: 'text', w: 288, skelW: '84%', title: (r) => r.address,
    sortVal: (r) => r.address.toLowerCase(), render: (r) => <OpenTag>{r.address}</OpenTag> },
  { key: 'views_7d', type: 'int4', w: 132, num: true, skelW: '44%',
    sortVal: (r) => r.views_7d, render: (r) => num(r.views_7d) },
  { key: 'visitors', type: 'int4', w: 132, num: true, skelW: '40%',
    sortVal: (r) => r.visitors, render: (r) => num(r.visitors) },
  { key: 'top_signal', type: 'enum', w: 134, skelW: '70%',
    sortVal: (r) => SIGNAL_ORDER[r.top_signal], render: (r) => <Signal value={r.top_signal} /> },
  { key: 'last_viewed', type: 'timestamptz', w: 190, skelW: '88%', defaultSort: true,
    sortVal: (r) => r.last_viewed, title: (r) => r.last_viewed ?? 'null',
    render: (r) => (r.last_viewed ? <span className={styles.vTs}>{r.last_viewed}</span> : <NullCell field="last_viewed" />) },
]

// ── page shell ────────────────────────────────────────────────────────
export function ReferenceTables({
  contacts,
  properties,
  workspaceName = 'workspace',
  headerAction,
}: {
  /** Pass only the table(s) this route should show — `/contacts` renders the
   *  contacts block, `/properties` the properties block. */
  contacts?: ContactRow[]
  properties?: PropertyRow[]
  /** Breadcrumb tail — the workspace name (NOT "public"). */
  workspaceName?: string
  /** HOR-410: optional action rendered in the header (e.g. "Add property").
   *  The table stays read-only; this is a top-level affordance beside it. */
  headerAction?: React.ReactNode
}) {
  const router = useRouter()

  // Each route shows a single table — the serif heading is its name.
  const heading = contacts ? 'Contacts' : properties ? 'Properties' : 'Reference tables'

  // "synced HH:MM" — initialised to the design value to keep SSR/first render
  // stable, then set to the real local time on mount (no hydration mismatch).
  const [synced, setSynced] = React.useState('14:08')
  React.useEffect(() => {
    const d = new Date()
    setSynced(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
  }, [])

  return (
    <div className={styles.substrate} data-theme="light" data-density="regular">
      <div className={styles.inner}>
        <header className={styles.head}>
          <div className={styles.headMain}>
            <span className={styles.schema}>{heading}</span>
            <span className={styles.crumb}>
              horace_intel <span className={styles.sep}>/</span> <b>{workspaceName}</b>
            </span>
          </div>
          <span className={styles.sub}>
            <span className={styles.dot} /> read-only · synced {synced}
          </span>
          {headerAction && (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {headerAction}
            </div>
          )}
        </header>

        {contacts && (
          <TableBlock<ContactRow>
            table="contacts"
            name="contacts"
            columns={CONTACT_COLUMNS}
            rows={contacts}
            signalKey="signal"
            signalOf={(r) => r.signal}
            searchOf={(r) => `${r.name} ${r.email ?? ''}`}
            searchPlaceholder="search name or email"
            onOpen={(r) => router.push(`/contacts/${r.id}`)}
          />
        )}
        {properties && (
          <TableBlock<PropertyRow>
            table="properties"
            name="properties"
            columns={PROPERTY_COLUMNS}
            rows={properties}
            signalKey="top_signal"
            signalOf={(r) => r.top_signal}
            searchOf={(r) => r.address}
            searchPlaceholder="search address"
            onOpen={(r) => router.push(`/properties/${r.id}`)}
          />
        )}
      </div>
    </div>
  )
}
