'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { BellButton } from '@/components/dashboard/bell-button'
import { PropertiesMap } from '@/components/properties/properties-map'
import { useSidebarPref } from '@/lib/ui/use-sidebar-pref'
import type { MapPayload, PropertySignal, TimeWindow } from '@/lib/map/rpc-types'
import { isTimeWindow } from '@/lib/map/rpc-types'
import { TimeSlider } from './time-slider'
import { PropertyOverlay } from './property-overlay'

/**
 * MarketView — v2 `/market` top-level client component (HOR-245).
 *
 * Lifts the shipped HOR-215 map surface out of `/properties` and
 * restyles the chrome:
 *   - Compact topbar — eyebrow `Insights · Market map` + h1 `Market`,
 *     right-side counters + bell.
 *   - Cream Horace voice line with the payload's summary.
 *   - Full-bleed map (PropertiesMap unchanged — pin styling rewritten
 *     in-place to the v2 heat tiers).
 *   - Right-side PropertyOverlay listening on `#signal=<id>` (same
 *     hash mechanism HOR-219 used; signal-panel.tsx replaced by the
 *     new overlay).
 *   - TimeSlider pinned along the bottom.
 *
 * First-visit collapse: on first navigation to /market, force the
 * sidebar into its collapsed mode once. Guarded by
 * `horace.market.firstVisitDone` in localStorage.
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
  const [, , setSidebarCollapsed] = useSidebarPref()
  const [selectedId, setSelectedId] = useState<string | null>(null)
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

  // ── Hash-driven selection. PropertiesMap writes `#signal=<id>` on pin
  //   click; we read it here and feed PropertyOverlay. Same mechanism
  //   HOR-219's signal-panel.tsx used — deep links survive the panel swap.
  useEffect(() => {
    if (typeof window === 'undefined') return
    function syncFromHash() {
      const m = /^#signal=(.+)$/.exec(window.location.hash)
      setSelectedId(m ? decodeURIComponent(m[1]) : null)
    }
    syncFromHash()
    window.addEventListener('hashchange', syncFromHash)
    return () => window.removeEventListener('hashchange', syncFromHash)
  }, [])

  function closeOverlay() {
    if (typeof window === 'undefined') return
    history.replaceState(null, '', window.location.pathname + window.location.search)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }

  const selectedProperty = useMemo<PropertySignal | null>(() => {
    if (!selectedId || !payload) return null
    return payload.properties.find((p) => p.id === selectedId) ?? null
  }, [selectedId, payload])

  const counters = payload?.counters ?? { warm: 0, active: 0, stirring: 0 }

  return (
    <div
      style={{
        flex: 1,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--color-parchment, #F5F0E8)',
      }}
    >
      {/* ── Compact topbar ───────────────────────────────────────── */}
      <header
        style={{
          padding: '20px 28px 14px',
          borderBottom: '1px solid rgba(140,123,107,0.18)',
          background: 'var(--color-parchment, #F5F0E8)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 14,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              className="label-uppercase"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 6,
                whiteSpace: 'nowrap',
                color: '#8C7B6B',
                fontSize: 11,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#C4622D',
                }}
              />
              Insights · Market map
            </div>
            <h1
              className="font-display"
              style={{
                margin: 0,
                fontSize: 28,
                fontWeight: 600,
                color: '#1A1612',
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
              }}
            >
              Market
            </h1>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              flexShrink: 0,
            }}
          >
            <Counter value={counters.warm} label="warm" color="#E8956D" />
            <Counter value={counters.active} label="active" color="#C4622D" />
            <Counter value={counters.stirring} label="stirring" color="#3D5246" />
            <BellButton attentionCount={attentionCount} />
          </div>
        </div>

        {/* Horace voice line — cream card, italic Playfair */}
        <div
          style={{
            padding: '10px 16px',
            background: '#FAF7F2',
            borderRadius: 10,
            border: '1px solid rgba(140,123,107,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontSize: 14,
            color: '#2E2823',
            lineHeight: 1.4,
            opacity: loading ? 0.7 : 1,
            transition: 'opacity 220ms var(--ease-out)',
          }}
        >
          <Sparkles size={13} color="#C4622D" style={{ flexShrink: 0 }} aria-hidden />
          <span>{payload?.summary || 'Horace is reading the market.'}</span>
        </div>
      </header>

      {/* ── Map + overlay ───────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          display: 'flex',
          overflow: 'hidden',
          background: '#E8E6DC',
          filter: loading ? 'saturate(0.6)' : 'none',
          transition: 'filter 220ms var(--ease-out)',
        }}
      >
        <div style={{ flex: 1, position: 'relative' }}>
          <PropertiesMap payload={payload} fallbackCenter={fallbackCenter} />
        </div>

        {selectedProperty && (
          <PropertyOverlay property={selectedProperty} onClose={closeOverlay} />
        )}
      </div>

      {/* ── Time slider ─────────────────────────────────────────── */}
      <footer
        style={{
          padding: '14px 28px 18px',
          background: 'var(--color-parchment, #F5F0E8)',
          borderTop: '1px solid rgba(140,123,107,0.18)',
          flexShrink: 0,
        }}
      >
        <TimeSlider value={timeWindow} onChange={handleTimeChange} />
      </footer>
    </div>
  )
}

// ── Counter ──────────────────────────────────────────────────────────────────

function Counter({
  value,
  label,
  color,
}: {
  value: number
  label: string
  color: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }}
        aria-hidden
      />
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: '#1A1612',
          fontWeight: 500,
        }}
      >
        {String(value).padStart(2, '0')}
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: '#8C7B6B',
        }}
      >
        {label}
      </span>
    </div>
  )
}

// Re-export the helper for use by the server page when parsing
// ?timeWindow from search params.
export { isTimeWindow }
