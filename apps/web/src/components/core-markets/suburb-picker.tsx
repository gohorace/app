'use client'

/**
 * Suburb picker — reusable typeahead for selecting up to N AU localities.
 *
 * Used by:
 *   • Onboarding step-core-markets (HOR-194) — min 1, max 3.
 *   • Settings → Core markets (HOR-196) — with `disabledLocalityPids` to
 *     prevent re-adding the agent's already-active selections.
 *
 * Data source: GET /api/localities/search?q=…&limit=10 → search_localities
 * RPC over gnaf.localities (HOR-192). The RPC enforces a 2-char minimum
 * and orders prefix-match-first with pg_trgm similarity as tiebreaker.
 *
 * Selected items render as removable chips above the input. The input
 * disables itself when `selected.length >= max`.
 *
 * Keyboard: ArrowDown / ArrowUp move highlight, Enter selects, Escape
 * closes the dropdown. Click-outside also closes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import styles from './suburb-picker.module.css'

export interface SelectedLocality {
  locality_pid:  string
  locality_name: string
  state_abbrev:  string
  postcode:      string | null
}

interface Props {
  selected:                SelectedLocality[]
  onChange:                (next: SelectedLocality[]) => void
  /** Minimum selections required before downstream "Submit" enables. Display-only here. */
  min?:                    number
  /** Hard cap on selections; the input disables once reached. */
  max?:                    number
  /** Localities already-active (e.g. agent's existing markets in Settings) — hidden from results. */
  disabledLocalityPids?:   string[]
  /** Auto-focus on mount. Default: false. */
  autoFocus?:              boolean
  /** Override the default placeholder. */
  placeholder?:            string
}

const DEBOUNCE_MS = 250
const MAX_RESULTS = 10

export function SuburbPicker({
  selected,
  onChange,
  max = 3,
  disabledLocalityPids = [],
  autoFocus = false,
  placeholder = 'Type a suburb…',
}: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SelectedLocality[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Set of selected + disabled pids — filtered out of search results.
  const hiddenPids = useMemo(() => {
    const s = new Set<string>(disabledLocalityPids)
    for (const sel of selected) s.add(sel.locality_pid)
    return s
  }, [selected, disabledLocalityPids])

  const atMax = selected.length >= max

  // Auto-focus on mount.
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // Debounced search. AbortController lets a fast typer cancel in-flight
  // requests when they type the next character.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setLoading(false)
      setError(null)
      return
    }
    if (atMax) {
      setResults([])
      return
    }

    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/localities/search?q=${encodeURIComponent(q)}&limit=${MAX_RESULTS}`,
          { signal: ctrl.signal },
        )
        if (!res.ok) {
          setError('Search failed — try again')
          setResults([])
          return
        }
        const json = (await res.json()) as { results: SelectedLocality[] }
        const filtered = (json.results ?? []).filter((r) => !hiddenPids.has(r.locality_pid))
        setResults(filtered)
        setHighlight(0)
        setOpen(true)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError('Network error — try again')
        setResults([])
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [query, hiddenPids, atMax])

  // Click outside → close dropdown (but keep selections).
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const addSelection = useCallback((row: SelectedLocality) => {
    if (atMax) return
    if (selected.some((s) => s.locality_pid === row.locality_pid)) return
    onChange([...selected, row])
    setQuery('')
    setResults([])
    setOpen(false)
    inputRef.current?.focus()
  }, [atMax, selected, onChange])

  const removeSelection = useCallback((pid: string) => {
    onChange(selected.filter((s) => s.locality_pid !== pid))
    inputRef.current?.focus()
  }, [selected, onChange])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) {
      // Backspace in an empty input pops the last chip — natural picker
      // behaviour for fast editing.
      if (e.key === 'Backspace' && query === '' && selected.length > 0) {
        removeSelection(selected[selected.length - 1].locality_pid)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = results[highlight]
      if (pick) addSelection(pick)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className={styles.container} ref={containerRef}>
      {/* Chip rail */}
      <div className={styles.chipRail} role="list" aria-label="Selected suburbs">
        {selected.map((s) => (
          <span key={s.locality_pid} className={styles.chip} role="listitem">
            <span className={styles.chipLabel}>
              {s.locality_name}, {s.state_abbrev}
              {s.postcode && <span className={styles.chipPostcode}> {s.postcode}</span>}
            </span>
            <button
              type="button"
              className={styles.chipRemove}
              onClick={() => removeSelection(s.locality_pid)}
              aria-label={`Remove ${s.locality_name}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>

      {/* Input + dropdown */}
      <div className={styles.inputWrap}>
        <Search size={16} className={styles.inputIcon} aria-hidden />
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true) }}
          onKeyDown={onKeyDown}
          placeholder={atMax ? `Maximum ${max} suburbs selected` : placeholder}
          disabled={atMax}
          aria-label="Search for a suburb"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="suburb-picker-results"
        />
        {loading && <span className={styles.spinner} aria-hidden />}
      </div>

      {open && results.length > 0 && (
        <ul
          id="suburb-picker-results"
          className={styles.dropdown}
          role="listbox"
        >
          {results.map((row, i) => (
            <li
              key={row.locality_pid}
              className={`${styles.option} ${i === highlight ? styles.optionActive : ''}`}
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                // mousedown not click — click fires after blur which has
                // already closed the dropdown.
                e.preventDefault()
                addSelection(row)
              }}
            >
              <span className={styles.optionName}>{row.locality_name}</span>
              <span className={styles.optionMeta}>
                {row.state_abbrev}{row.postcode && ` · ${row.postcode}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}
