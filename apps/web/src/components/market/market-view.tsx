'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { BellButton } from '@/components/dashboard/bell-button'
import { PropertiesMap, type PropertiesMapHandle } from '@/components/properties/properties-map'
import { useSidebarPref } from '@/lib/ui/use-sidebar-pref'
import type { MapPayload, PropertySignal, SuburbSignal, TimeWindow } from '@/lib/map/rpc-types'
import { TimeSlider } from './time-slider'
import { DetailPanel, type Selection } from './detail-panel'
import styles from './market-map.module.css'

/**
 * MarketView — the `/market` hero-substrate map (HOR-370).
 *
 * The map is the page: a full-bleed `.map-canvas` fills the content area
 * with the Google map, and every control floats on top as a glass overlay
 * (wayfinding, bell, time scrubber, zoom, detail panel). The old chrome —
 * header (eyebrow/h1/counters/Horace summary) and footer (slider wrapper) —
 * is gone per the HOR-368 decision.
 *
 * Selection is hash-driven so deep links survive: `#signal=<id>` opens the
 * property panel (written by a pin click in `PropertiesMap`), `#suburb=<id>`
 * opens the suburb panel (written by a choropleth/label click at city zoom).
 *
 * Zoom: the glass +/- buttons nudge the live Google zoom incrementally (via
 * the map's imperative handle), so they stay consistent with mouse-scroll.
 * The choropleth (city read) vs radial heat + pins (neighbourhood read) switch
 * is derived inside `PropertiesMap` from the live zoom, not a discrete toggle.
 *
 * First-visit collapse: on first navigation to /market, force the sidebar
 * collapsed once (guarded by `horace.market.firstVisitDone`).
 */

interface MarketViewProps {
  initialPayload: MapPayload | null
  initialTimeWindow: TimeWindow
  fallbackCenter: { lat: number; lng: number } | null
  attentionCount: number
}

const FIRST_VISIT_KEY = 'horace.market.firstVisitDone'

export function MarketView({
  initialPayload,
  initialTimeWindow,
  fallbackCenter,
  attentionCount,
}: MarketViewProps) {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>(initialTimeWindow)
  const [payload, setPayload] = useState<MapPayload | null>(initialPayload)
  const [loading, setLoading] = useState(false)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [, , setSidebarCollapsed] = useSidebarPref()
  const mapRef = useRef<PropertiesMapHandle>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchAbortRef = useRef<AbortController | null>(null)

  // ── First-visit collapse: fire once on mount when the marker is unset.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (window.localStorage.getItem(FIRST_VISIT_KEY) === 'true') return
      setSidebarCollapsed(true)
      window.localStorage.setItem(FIRST_VISIT_KEY, 'true')
    } catch {
      // localStorage disabled — degrade silently; sidebar stays as-is.
    }
    // setSidebarCollapsed is stable; intentionally fire-once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Time-window refetch (debounced 250ms, abortable; HOR-217 pattern).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(() => {
      if (fetchAbortRef.current) fetchAbortRef.current.abort()
      const controller = new AbortController()
      fetchAbortRef.current = controller

      setLoading(true)
      fetch(`/api/properties/map-payload?timeWindow=${timeWindow}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((data: MapPayload) => {
          if (controller.signal.aborted) return
          setPayload(data)
        })
        .catch((err) => {
          if (controller.signal.aborted) return
          console.error('[market-view] map-payload fetch failed:', err)
        })
        .finally(() => {
          if (controller.signal.aborted) return
          setLoading(false)
        })
    }, 250)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [timeWindow])

  // ── URL sync for the time window (replaceState; no Next.js re-render).
  function handleTimeChange(next: TimeWindow) {
    setTimeWindow(next)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('timeWindow', next)
      window.history.replaceState(null, '', url.toString())
    }
  }

  // ── Hash-driven selection. PropertiesMap writes `#signal=<id>` (pin) and
  //   `#suburb=<id>` (choropleth/label) on click; we read both here.
  useEffect(() => {
    if (typeof window === 'undefined') return
    function syncFromHash() {
      const sig = /^#signal=(.+)$/.exec(window.location.hash)
      if (sig) {
        setSelection({ kind: 'pin', id: decodeURIComponent(sig[1]) })
        return
      }
      const sub = /^#suburb=(.+)$/.exec(window.location.hash)
      if (sub) {
        setSelection({ kind: 'suburb', id: decodeURIComponent(sub[1]) })
        return
      }
      setSelection(null)
    }
    syncFromHash()
    window.addEventListener('hashchange', syncFromHash)
    return () => window.removeEventListener('hashchange', syncFromHash)
  }, [])

  function clearHashSelection() {
    if (typeof window === 'undefined') return
    history.replaceState(null, '', window.location.pathname + window.location.search)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }

  const selectedProperty = useMemo<PropertySignal | null>(() => {
    if (selection?.kind !== 'pin' || !payload) return null
    return payload.properties.find((p) => p.id === selection.id) ?? null
  }, [selection, payload])

  const selectedSuburb = useMemo<SuburbSignal | null>(() => {
    if (selection?.kind !== 'suburb' || !payload) return null
    return payload.suburbs.find((s) => s.id === selection.id) ?? null
  }, [selection, payload])

  const selectedPinId = selection?.kind === 'pin' ? selection.id : null
  const panelOpen = !!selection

  return (
    <div className={styles.mapCanvas} style={{ height: '100%' }}>
      {/* ── Map (fills the canvas; overlays sit above) ─────────────── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          filter: loading ? 'saturate(0.6)' : 'none',
          transition: 'filter 220ms var(--ease-out)',
        }}
      >
        <PropertiesMap
          ref={mapRef}
          payload={payload}
          fallbackCenter={fallbackCenter}
          selectedPinId={selectedPinId}
          fill
        />
      </div>

      {/* ── Wayfinding (top-left, click-through) ───────────────────── */}
      <div className={styles.wayfinding}>
        <div className={styles.wayfindingTitle}>Market</div>
      </div>

      {/* ── Floating bell (top-right; slides clear of an open panel) ── */}
      <div className={styles.bellChip} style={{ right: panelOpen ? 368 : 18 }}>
        <BellButton attentionCount={attentionCount} />
      </div>

      {/* ── Time scrubber (bottom-center glass pill) ───────────────── */}
      <div className={styles.timeScrubber}>
        <TimeSlider value={timeWindow} onChange={handleTimeChange} />
      </div>

      {/* ── Zoom control (beside the scrubber) — incremental, matches scroll ── */}
      <div className={styles.zoomCtrl}>
        <button
          type="button"
          className={styles.zoomBtn}
          onClick={() => mapRef.current?.zoomBy(1)}
          aria-label="Zoom in"
        >
          <Plus size={14} />
        </button>
        <div className={styles.zoomDivider} aria-hidden />
        <button
          type="button"
          className={styles.zoomBtn}
          onClick={() => mapRef.current?.zoomBy(-1)}
          aria-label="Zoom out"
        >
          <Minus size={14} />
        </button>
      </div>

      {/* ── Detail panel (top-right, two variants) ─────────────────── */}
      {selection && (
        <DetailPanel
          selection={selection}
          property={selectedProperty}
          suburb={selectedSuburb}
          onClose={clearHashSelection}
        />
      )}
    </div>
  )
}
