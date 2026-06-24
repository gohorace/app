'use client'

/**
 * Location picker (HOR-410) — granularity-aware typeahead for the Core
 * Markets import flow. Supersedes the suburb-only SuburbPicker by adding
 * Street and Building/Complex scopes behind a segmented control:
 *
 *   • Suburb   → /api/localities/search  (gnaf.localities)
 *   • Street   → /api/streets/search     (gnaf.street_localities)
 *   • Building → /api/buildings/search   (gnaf.complexes, structural P/S)
 *
 * Suburb is the default, preserving prior behaviour. Selections from any
 * granularity collect into one chip rail (max N) and POST to
 * /api/core-markets via placeToPostBody(). Results surface the locality +
 * postcode for disambiguation and an approximate count before confirming.
 *
 * Keyboard + click behaviour mirrors SuburbPicker (ArrowUp/Down, Enter,
 * Escape, click-outside, Backspace-pops-last-chip).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import styles from './suburb-picker.module.css'

export type Granularity = 'suburb' | 'street' | 'building'

export interface SelectedPlace {
  granularity:            Granularity
  locality_pid:           string
  locality_name:          string
  state_abbrev:           string
  postcode:               string | null
  street_locality_pid:    string | null
  building_number_first:  string | null
  street_name:            string | null
  /** Human label for the chip. */
  label:                  string
  /** Approximate scope size (addresses for street, units for building). */
  countHint:              number | null
}

/** Stable identity for a place across the three granularities. */
export function placeKey(p: Pick<SelectedPlace, 'granularity' | 'locality_pid' | 'street_locality_pid' | 'building_number_first'>): string {
  if (p.granularity === 'suburb')  return `suburb:${p.locality_pid}`
  if (p.granularity === 'street')  return `street:${p.street_locality_pid}`
  return `building:${p.street_locality_pid}:${p.building_number_first}`
}

/** Build the POST /api/core-markets body for a selected place. */
export function placeToPostBody(p: SelectedPlace): Record<string, string> {
  if (p.granularity === 'suburb') {
    return { granularity: 'suburb', locality_pid: p.locality_pid }
  }
  if (p.granularity === 'street') {
    return { granularity: 'street', street_locality_pid: p.street_locality_pid ?? '' }
  }
  return {
    granularity: 'building',
    street_locality_pid: p.street_locality_pid ?? '',
    building_number_first: p.building_number_first ?? '',
  }
}

interface Props {
  selected:        SelectedPlace[]
  onChange:        (next: SelectedPlace[]) => void
  min?:            number
  max?:            number
  /** placeKey()s already active elsewhere (e.g. existing markets) — hidden from results. */
  disabledKeys?:   string[]
  autoFocus?:      boolean
}

const DEBOUNCE_MS = 250
const MAX_RESULTS = 10
const EMPTY_KEYS: string[] = []

const GRAN_LABELS: Record<Granularity, string> = {
  suburb:   'Suburb',
  street:   'Street',
  building: 'Building',
}

const PLACEHOLDERS: Record<Granularity, string> = {
  suburb:   'e.g. Paddington',
  street:   'e.g. George Street',
  building: 'e.g. 10 Kent Street',
}

// ── Per-granularity result shapes (mirror the API route payloads) ──────────
interface LocalityResult {
  locality_pid: string; locality_name: string; state_abbrev: string; postcode: string | null
}
interface StreetResult {
  street_locality_pid: string; street_name: string; locality_pid: string
  locality_name: string; state_abbrev: string; postcode: string | null; address_count: number
}
interface BuildingResult {
  complex_key: string; street_locality_pid: string; number_first: string; street_name: string
  locality_pid: string; locality_name: string; state_abbrev: string; postcode: string | null
  unit_count: number
}

/** A normalised option row the dropdown renders, plus the place it maps to. */
interface Option {
  key:   string
  name:  string
  meta:  string
  count: number | null
  place: SelectedPlace
}

const ENDPOINT: Record<Granularity, string> = {
  suburb:   '/api/localities/search',
  street:   '/api/streets/search',
  building: '/api/buildings/search',
}

function metaLine(localityName: string, state: string, postcode: string | null): string {
  return `${localityName} · ${state}${postcode ? ` · ${postcode}` : ''}`
}

function toOptions(granularity: Granularity, rows: unknown[]): Option[] {
  if (granularity === 'suburb') {
    return (rows as LocalityResult[]).map((r) => {
      const place: SelectedPlace = {
        granularity: 'suburb',
        locality_pid: r.locality_pid, locality_name: r.locality_name,
        state_abbrev: r.state_abbrev, postcode: r.postcode,
        street_locality_pid: null, building_number_first: null, street_name: null,
        label: `${r.locality_name}, ${r.state_abbrev}`, countHint: null,
      }
      return { key: placeKey(place), name: r.locality_name, meta: `${r.state_abbrev}${r.postcode ? ` · ${r.postcode}` : ''}`, count: null, place }
    })
  }
  if (granularity === 'street') {
    return (rows as StreetResult[]).map((r) => {
      const place: SelectedPlace = {
        granularity: 'street',
        locality_pid: r.locality_pid, locality_name: r.locality_name,
        state_abbrev: r.state_abbrev, postcode: r.postcode,
        street_locality_pid: r.street_locality_pid, building_number_first: null,
        street_name: r.street_name,
        label: `${r.street_name}, ${r.locality_name}`, countHint: r.address_count,
      }
      return { key: placeKey(place), name: r.street_name, meta: metaLine(r.locality_name, r.state_abbrev, r.postcode), count: r.address_count, place }
    })
  }
  return (rows as BuildingResult[]).map((r) => {
    const addr = `${r.number_first} ${r.street_name}`
    const place: SelectedPlace = {
      granularity: 'building',
      locality_pid: r.locality_pid, locality_name: r.locality_name,
      state_abbrev: r.state_abbrev, postcode: r.postcode,
      street_locality_pid: r.street_locality_pid, building_number_first: r.number_first,
      street_name: r.street_name,
      label: `${addr}, ${r.locality_name}`, countHint: r.unit_count,
    }
    return { key: placeKey(place), name: addr, meta: metaLine(r.locality_name, r.state_abbrev, r.postcode), count: r.unit_count, place }
  })
}

export function LocationPicker({
  selected,
  onChange,
  max = 3,
  disabledKeys = EMPTY_KEYS,
  autoFocus = false,
}: Props) {
  const [granularity, setGranularity] = useState<Granularity>('suburb')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Option[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const hiddenKeys = useMemo(() => {
    const s = new Set<string>(disabledKeys)
    for (const sel of selected) s.add(placeKey(sel))
    return s
  }, [selected, disabledKeys])

  const atMax = selected.length >= max

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // Debounced search, scoped to the active granularity.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([]); setLoading(false); setError(null); setSearched(false)
      return
    }
    if (atMax) { setResults([]); return }

    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `${ENDPOINT[granularity]}?q=${encodeURIComponent(q)}&limit=${MAX_RESULTS}`,
          { signal: ctrl.signal },
        )
        if (!res.ok) { setError('Search failed — try again'); setResults([]); return }
        const json = (await res.json()) as { results: unknown[] }
        const opts = toOptions(granularity, json.results ?? []).filter((o) => !hiddenKeys.has(o.key))
        setResults(opts)
        setHighlight(0)
        setOpen(true)
        setSearched(true)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError('Network error — try again'); setResults([])
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => { clearTimeout(timer); ctrl.abort() }
  }, [query, granularity, hiddenKeys, atMax])

  // Click outside → close dropdown.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const addSelection = useCallback((opt: Option) => {
    if (atMax) return
    if (selected.some((s) => placeKey(s) === opt.key)) return
    onChange([...selected, opt.place])
    setQuery(''); setResults([]); setOpen(false); setSearched(false)
    inputRef.current?.focus()
  }, [atMax, selected, onChange])

  const removeSelection = useCallback((key: string) => {
    onChange(selected.filter((s) => placeKey(s) !== key))
    inputRef.current?.focus()
  }, [selected, onChange])

  const switchGranularity = (g: Granularity) => {
    if (g === granularity) return
    setGranularity(g)
    setQuery(''); setResults([]); setOpen(false); setSearched(false); setError(null)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) {
      if (e.key === 'Backspace' && query === '' && selected.length > 0) {
        removeSelection(placeKey(selected[selected.length - 1]))
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setHighlight((h) => Math.min(h + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault(); const pick = results[highlight]; if (pick) addSelection(pick)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showNoResults = !loading && searched && results.length === 0 && query.trim().length >= 2 && !error

  return (
    <div className={styles.container} ref={containerRef}>
      {/* Granularity toggle */}
      <div className={styles.granToggle} role="tablist" aria-label="Import granularity">
        {(['suburb', 'street', 'building'] as Granularity[]).map((g) => (
          <button
            key={g}
            type="button"
            role="tab"
            aria-selected={granularity === g}
            className={`${styles.granOption} ${granularity === g ? styles.granOptionActive : ''}`}
            onClick={() => switchGranularity(g)}
          >
            {GRAN_LABELS[g]}
          </button>
        ))}
      </div>

      {/* Chip rail */}
      <div className={styles.chipRail} role="list" aria-label="Selected locations">
        {selected.map((s) => {
          const key = placeKey(s)
          return (
            <span key={key} className={styles.chip} role="listitem">
              <span className={styles.chipLabel}>
                {s.label}
                {s.postcode && <span className={styles.chipPostcode}> {s.postcode}</span>}
              </span>
              <button
                type="button"
                className={styles.chipRemove}
                onClick={() => removeSelection(key)}
                aria-label={`Remove ${s.label}`}
              >
                <X size={12} />
              </button>
            </span>
          )
        })}
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
          placeholder={atMax ? `Maximum ${max} selected` : PLACEHOLDERS[granularity]}
          disabled={atMax}
          aria-label={`Search for a ${granularity}`}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="location-picker-results"
        />
        {loading && <span className={styles.spinner} aria-hidden />}
      </div>

      {open && results.length > 0 && (
        <ul id="location-picker-results" className={styles.dropdown} role="listbox">
          {results.map((row, i) => (
            <li
              key={row.key}
              className={`${styles.option} ${i === highlight ? styles.optionActive : ''}`}
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => { e.preventDefault(); addSelection(row) }}
            >
              <span className={styles.optionName}>
                {row.name}
                {row.count != null && (
                  <span className={styles.optionCount}>
                    ≈ {row.count.toLocaleString()} {granularity === 'building' ? 'units' : 'addresses'}
                  </span>
                )}
              </span>
              <span className={styles.optionMeta}>{row.meta}</span>
            </li>
          ))}
        </ul>
      )}

      {showNoResults && (
        <div className={styles.noResults}>
          No {granularity === 'building' ? 'buildings' : `${granularity}s`} match “{query.trim()}”.
          {granularity === 'building' && ' Try the street name, optionally with the number (e.g. “10 Kent Street”).'}
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}
