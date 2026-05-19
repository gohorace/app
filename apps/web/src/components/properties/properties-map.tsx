'use client'

/**
 * Properties map — Google Maps signal layer (HOR-218 on top of HOR-195's base).
 *
 * Consumes the `MapPayload` from `/api/properties/map-payload` (HOR-216) and
 * renders four layers on top of the Google base:
 *
 *   1. **Heat layer.** Terracotta gradient, opacity-capped at 0.6, radius
 *      banded by zoom (suburb / transition / street levels per the brief).
 *   2. **Suburb labels** as custom `OverlayView` DOM nodes positioned at the
 *      GNAF locality centroid. Weight + colour driven by suburb `state`.
 *      Stirring suburbs get an animated terracotta dot suffix.
 *   3. **Property pins** in three v2 heat tiers (HOR-245):
 *        - intensity > 0.6 → 14px terracotta dot + per-pin halo
 *          (halo radius = 3 + intensity*6, opacity = 0.08 + intensity*0.08)
 *        - intensity 0.5–0.6 → 11px mustard dot
 *        - intensity < 0.5 → 8px stone dot
 *      (The pre-v2 quiet / active / hot geometry was discarded in favour
 *      of the heat-driven sizing — `state` is still in the payload for
 *      legacy callers but the pin renderer reads `intensity` directly.)
 *   4. **Clustering** above 200 pins via `@googlemaps/markerclusterer` with a
 *      custom hot-pin-styled cluster bubble (not a numbered circle, per brief).
 *
 * Click → hash:
 *   - Pin click sets `location.hash = '#signal=<id>'`. v2-M4's
 *     `PropertyOverlay` (`components/market/property-overlay.tsx`) reads
 *     the hash and mounts itself; HOR-219's signal-panel.tsx was removed
 *     in HOR-245 along with the suburb panel.
 *   - Suburb-label click pans + zooms the map to the suburb centroid
 *     (HOR-245 dropped the suburb panel; suburb interactions are a
 *     navigation aid only).
 *
 * Loader pattern matches the previous version + `address-autocomplete.tsx` —
 * same loader, same env var (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`).
 */

import { useEffect, useRef, useState } from 'react'
import { Loader } from '@googlemaps/js-api-loader'
import { MarkerClusterer } from '@googlemaps/markerclusterer'
import type { Cluster, ClusterStats } from '@googlemaps/markerclusterer'
import { MapPin } from 'lucide-react'
import type {
  MapPayload,
  PropertySignal,
  PropertyState,
  SuburbSignal,
  SuburbState,
} from '@/lib/map/rpc-types'

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
// Last-resort centre when there are no payload pins and no core-market
// centroid (e.g. a fresh agent before any import). Sydney CBD.
const HORACE_HQ_FALLBACK = { lat: -33.8688, lng: 151.2093 }

const CLUSTER_THRESHOLD = 200  // brief: cluster only when > 200 visible

// ─── Palette (matches design tokens used elsewhere in the dashboard) ────────
const COLOR = {
  terracotta:  '#C4622D',
  ink:         '#1A1612',
  parchment:   '#FAF7F2',
  stone:       '#8C7B6B',
}

// ─── Palette additions for v2 pin tiers (HOR-245) ──────────────────────────
const PIN_V2 = {
  terracotta: '#C4622D',
  mustard:    '#B5922A',
  stone:      '#8C7B6B',
} as const

// ─── SVG markup per pin tier (v2 — HOR-245) ─────────────────────────────────
// Tier breakdown:
//   intensity > 0.6  → 14px terracotta dot + per-pin halo
//                      (halo radius = 3 + intensity*6, opacity = 0.08 + intensity*0.08)
//   intensity 0.5–0.6 → 11px mustard dot
//   intensity < 0.5  → 8px stone dot
//
// The halo is rendered as a backing circle inside the same SVG so the
// AdvancedMarkerElement gets a single positioned node per pin; the pin
// dot sits centred on top. Total SVG bounding box is sized to fit the
// largest halo at intensity = 1.0 (radius 9, diameter 18) plus the 14px
// dot — we use 32x32 to keep it square + give a little breathing room.

function pinSvg(intensity: number): string {
  const i = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0

  if (i > 0.6) {
    // 14px terracotta dot + halo. Halo per the v2 spec.
    const haloR = 3 + i * 6           // 6.6..9
    const haloOpacity = 0.08 + i * 0.08  // 0.128..0.16
    return `
      <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="${haloR.toFixed(2)}" fill="${PIN_V2.terracotta}" opacity="${haloOpacity.toFixed(3)}"/>
        <circle cx="16" cy="16" r="7" fill="${PIN_V2.terracotta}" stroke="rgba(250,247,242,0.85)" stroke-width="1.5"/>
      </svg>`
  }
  if (i >= 0.5) {
    // 11px mustard dot.
    return `
      <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="8" r="5.5" fill="${PIN_V2.mustard}" stroke="rgba(250,247,242,0.85)" stroke-width="1.5"/>
      </svg>`
  }
  // 8px stone dot.
  return `
    <svg width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
      <circle cx="6" cy="6" r="4" fill="${PIN_V2.stone}" stroke="rgba(250,247,242,0.85)" stroke-width="1.25"/>
    </svg>`
}

function pinElement(p: PropertySignal): HTMLElement {
  // HOR-220 a11y: the pin's visual SVG can be 6px (quiet tier), but the
  // hit/focus target must be ≥ 24px (WCAG 2.5.5 target size minimum).
  // Wrapper is a fixed 32×32 box with the SVG centred; cursor + focus ring
  // live on the wrapper.
  const wrap = document.createElement('div')
  wrap.style.cursor = 'pointer'
  wrap.style.width = '32px'
  wrap.style.height = '32px'
  wrap.style.display = 'flex'
  wrap.style.alignItems = 'center'
  wrap.style.justifyContent = 'center'
  wrap.style.borderRadius = '50%'
  wrap.style.outline = 'none'
  wrap.tabIndex = 0
  wrap.setAttribute('role', 'button')
  wrap.innerHTML = pinSvg(p.intensity)
  wrap.title = p.address
  // v2-M4: aria still announces the categorical state for screen readers
  // (the visual signal is intensity-driven, but the state buckets give
  // assistive tech a stable label vocabulary).
  wrap.setAttribute('aria-label', `${p.address} — ${p.state} signal`)
  // Focus + hover both surface a terracotta halo. Same treatment for both
  // so the focus state reads without colour-only reliance (the halo grows
  // the bounding box visibly).
  const showRing = () => {
    wrap.style.boxShadow = '0 0 0 3px rgba(196,98,45,0.32)'
  }
  const hideRing = () => {
    wrap.style.boxShadow = 'none'
  }
  wrap.addEventListener('mouseenter', showRing)
  wrap.addEventListener('mouseleave', hideRing)
  wrap.addEventListener('focus', showRing)
  wrap.addEventListener('blur',  hideRing)
  // Keyboard activation parity with click — Enter / Space fire a click event.
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      wrap.click()
    }
  })
  return wrap
}

// ─── Suburb label DOM (built per overlay instance) ──────────────────────────
// State-driven typography:
//   quiet    — DM Mono 10/400, faded grey
//   warm     — Playfair 11/600, dark ink
//   hot      — Playfair 12/700, dark ink (the strongest read)
//   stirring — Playfair 11/600, terracotta + animated dot suffix

function suburbLabelDom(s: SuburbSignal): HTMLElement {
  const wrap = document.createElement('div')
  wrap.style.position = 'absolute'
  wrap.style.transform = 'translate(-50%, -50%)'
  wrap.style.pointerEvents = s.state === 'quiet' ? 'none' : 'auto'
  wrap.style.cursor = s.state === 'quiet' ? 'default' : 'pointer'
  wrap.style.userSelect = 'none'
  wrap.style.whiteSpace = 'nowrap'
  // HOR-220 a11y: padding gives the label a ≥24px tap target; the visible
  // text is smaller but the click + focus area meets WCAG 2.5.5.
  wrap.style.padding = '6px 8px'
  wrap.style.borderRadius = '4px'
  wrap.style.outline = 'none'
  wrap.setAttribute('data-suburb-state', s.state)
  if (s.state !== 'quiet') {
    // Interactive suburbs are keyboard-reachable and screen-reader-labelled.
    wrap.tabIndex = 0
    wrap.setAttribute('role', 'button')
    // Hotfix: defend against null name (legacy suburb rows with no GNAF match
    // and no `properties.suburb` value can come through). Generic fallback
    // beats announcing "null — stirring suburb signal".
    wrap.setAttribute('aria-label', `${s.name ?? 'Suburb'} — ${s.state} suburb signal`)
    const showRing = () => {
      wrap.style.boxShadow = '0 0 0 3px rgba(196,98,45,0.22)'
    }
    const hideRing = () => {
      wrap.style.boxShadow = 'none'
    }
    wrap.addEventListener('mouseenter', showRing)
    wrap.addEventListener('mouseleave', hideRing)
    wrap.addEventListener('focus', showRing)
    wrap.addEventListener('blur', hideRing)
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        wrap.click()
      }
    })
  }

  const text = document.createElement('span')
  text.textContent = s.name ?? ''

  if (s.state === 'quiet') {
    text.style.fontFamily = "'DM Mono', monospace"
    text.style.fontSize = '10px'
    text.style.fontWeight = '400'
    text.style.letterSpacing = '0.07em'
    text.style.textTransform = 'uppercase'
    text.style.color = 'rgba(46,40,35,0.35)'
  } else if (s.state === 'stirring') {
    text.style.fontFamily = "'Playfair Display', serif"
    text.style.fontSize = '11px'
    text.style.fontWeight = '600'
    text.style.fontStyle = 'italic'
    text.style.letterSpacing = '-0.005em'
    text.style.color = 'rgba(196,98,45,0.88)'
  } else if (s.state === 'hot') {
    text.style.fontFamily = "'Playfair Display', serif"
    text.style.fontSize = '12px'
    text.style.fontWeight = '700'
    text.style.letterSpacing = '-0.005em'
    text.style.color = 'rgba(26,22,18,0.82)'
  } else {
    // warm
    text.style.fontFamily = "'Playfair Display', serif"
    text.style.fontSize = '11px'
    text.style.fontWeight = '600'
    text.style.letterSpacing = '-0.005em'
    text.style.color = 'rgba(26,22,18,0.62)'
  }

  wrap.appendChild(text)

  // Stirring suffix — animated terracotta dot with two ring pulses.
  // Matches prototype's `stir-ring` keyframes (MapView.jsx:116-122).
  if (s.state === 'stirring') {
    const dotWrap = document.createElement('span')
    dotWrap.style.position = 'relative'
    dotWrap.style.display = 'inline-block'
    dotWrap.style.width = '14px'
    dotWrap.style.height = '14px'
    dotWrap.style.marginLeft = '6px'
    dotWrap.style.verticalAlign = 'middle'

    // Inner solid dot
    const dot = document.createElement('span')
    dot.style.position = 'absolute'
    dot.style.left = '50%'
    dot.style.top  = '50%'
    dot.style.transform = 'translate(-50%, -50%)'
    dot.style.width = '5px'
    dot.style.height = '5px'
    dot.style.borderRadius = '50%'
    dot.style.background = COLOR.terracotta
    dotWrap.appendChild(dot)

    // Two pulse rings (the keyframes are injected once below).
    for (const cls of ['horace-stir-a', 'horace-stir-b']) {
      const ring = document.createElement('span')
      ring.style.position = 'absolute'
      ring.style.left = '50%'
      ring.style.top  = '50%'
      ring.style.width = '14px'
      ring.style.height = '14px'
      ring.style.borderRadius = '50%'
      ring.style.border = `1px solid ${COLOR.terracotta}`
      ring.style.transform = 'translate(-50%, -50%) scale(0.6)'
      ring.style.opacity = '0.9'
      ring.className = `horace-stir-ring ${cls}`
      dotWrap.appendChild(ring)
    }

    wrap.appendChild(dotWrap)
  }

  return wrap
}

// Injected once per page lifetime. Provides the keyframes for the stirring
// dot's two-phase pulse — using global CSS is simpler than CSS-in-JS for an
// imperative DOM overlay.
function ensureStirringKeyframes() {
  if (typeof document === 'undefined') return
  if (document.getElementById('horace-stir-keyframes')) return
  const style = document.createElement('style')
  style.id = 'horace-stir-keyframes'
  style.textContent = `
    @keyframes horace-stir-pulse {
      0%   { transform: translate(-50%, -50%) scale(0.6); opacity: 0.9; }
      80%  { transform: translate(-50%, -50%) scale(1.6); opacity: 0;   }
      100% { transform: translate(-50%, -50%) scale(1.6); opacity: 0;   }
    }
    .horace-stir-ring {
      animation: horace-stir-pulse 2.4s ease-out infinite;
    }
    .horace-stir-ring.horace-stir-b {
      animation-delay: 1.2s;
    }
  `
  document.head.appendChild(style)
}

// ─── Zoom-band helpers ──────────────────────────────────────────────────────

/** Heat radius per the brief's three zoom bands. */
function heatRadiusForZoom(z: number): number {
  if (z < 12) return 60
  if (z <= 14) return 35
  return 18
}

/** Suburb labels are primary at city zoom, recede at street zoom. */
function suburbLabelOpacityForZoom(z: number): number {
  if (z < 12) return 1
  if (z <= 14) return 0.7
  return 0.25
}

// ─── Cluster renderer ───────────────────────────────────────────────────────
//
// Brief: "cluster bubble uses the same pin treatment, not a numbered circle".
// We render the cluster as a hot-pin look scaled to cluster size — bigger
// halo, no number badge. The clusterer surfaces `cluster.count`; we don't
// surface it visually (the bubble size implies density).

function clusterRenderer(
  cluster: Cluster,
  _stats: ClusterStats,
  map: google.maps.Map,
): google.maps.marker.AdvancedMarkerElement {
  // Size scales gently with count — log-ish so 1000 markers don't blot the
  // map but 10 still differ visibly from 200.
  const c = cluster.count
  const halo = Math.min(64, Math.max(34, 24 + Math.sqrt(c) * 2.2))
  const dot  = Math.min(20, Math.max(8,  4  + Math.sqrt(c) * 0.7))

  const el = document.createElement('div')
  el.style.cursor = 'pointer'
  el.style.transform = 'translate(0, 0)'
  el.innerHTML = `
    <svg width="${halo}" height="${halo}" viewBox="0 0 ${halo} ${halo}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${halo/2}" cy="${halo/2}" r="${halo/2}" fill="${COLOR.terracotta}" opacity="0.14"/>
      <circle cx="${halo/2}" cy="${halo/2}" r="${halo*0.32}" fill="none" stroke="${COLOR.ink}" stroke-width="1.4" opacity="0.85"/>
      <circle cx="${halo/2}" cy="${halo/2}" r="${dot/2}" fill="${COLOR.ink}"/>
    </svg>
  `
  el.title = `${c} properties`
  el.setAttribute('aria-label', `${c} properties clustered here`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const G = (window as any).google
  const marker = new G.maps.marker.AdvancedMarkerElement({
    map,
    position: cluster.position,
    content: el,
    title: `${c} properties`,
  })
  // Click → zoom in on the cluster bounds.
  marker.addListener('click', () => {
    if (cluster.bounds) map.fitBounds(cluster.bounds, 64)
  })
  return marker
}

// ─── Component ──────────────────────────────────────────────────────────────

interface Props {
  payload:         MapPayload | null
  fallbackCenter?: { lat: number; lng: number } | null
}

export function PropertiesMap({ payload, fallbackCenter = null }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([])
  const clustererRef = useRef<MarkerClusterer | null>(null)
  const heatRef = useRef<google.maps.visualization.HeatmapLayer | null>(null)
  const suburbOverlaysRef = useRef<google.maps.OverlayView[]>([])
  const initialFitRef = useRef(false)
  const [degraded, setDegraded] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  // ── Mount: load Maps + visualization + marker libs, create the map ──────
  useEffect(() => {
    if (!API_KEY) {
      setDegraded('Map view requires a Google Maps key (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).')
      return
    }
    if (!hostRef.current) return

    let cancelled = false
    ensureStirringKeyframes()

    const loader = new Loader({ apiKey: API_KEY, version: 'weekly' })

    Promise.all([
      loader.importLibrary('maps'),
      loader.importLibrary('marker'),
      loader.importLibrary('visualization'),
    ])
      .then(([mapsLib]) => {
        if (cancelled || !hostRef.current) return
        const { Map: GMap } = mapsLib as google.maps.MapsLibrary

        const initialCenter = fallbackCenter ?? HORACE_HQ_FALLBACK
        const map = new GMap(hostRef.current, {
          center: initialCenter,
          zoom: 13,
          mapId: 'horace-properties-map', // required for AdvancedMarkerElement
          disableDefaultUI: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        })
        mapRef.current = map

        // Heat-radius update on zoom — the heat layer is rebuilt with a new
        // radius per band so the visual concentration matches the agent's
        // current focus level.
        map.addListener('zoom_changed', () => {
          const z = map.getZoom() ?? 13
          if (heatRef.current) heatRef.current.set('radius', heatRadiusForZoom(z))
          // Update suburb-label opacity in place — keeps suburb names primary
          // at city zoom, lets street labels take over at street zoom.
          const op = suburbLabelOpacityForZoom(z)
          for (const ov of suburbOverlaysRef.current) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const dom = (ov as any).getDom?.() as HTMLElement | undefined
            if (dom) dom.style.opacity = String(op)
          }
        })

        // Map background click (anywhere not on a pin/label) → close any
        // open panel by clearing the hash. The panel itself owns Esc-close,
        // but a tap-out-to-dismiss feels natural on the map surface.
        map.addListener('click', () => {
          if (typeof window === 'undefined') return
          if (window.location.hash.startsWith('#signal=') || window.location.hash.startsWith('#suburb=')) {
            history.replaceState(null, '', window.location.pathname + window.location.search)
            window.dispatchEvent(new HashChangeEvent('hashchange'))
          }
        })

        setReady(true)
      })
      .catch((err) => {
        console.error('[properties-map] loader failed', err)
        setDegraded('Map view is unavailable right now.')
      })

    return () => {
      cancelled = true
      // Tear down everything attached to the map.
      for (const m of markersRef.current) m.map = null
      markersRef.current = []
      if (clustererRef.current) {
        clustererRef.current.clearMarkers()
        clustererRef.current = null
      }
      if (heatRef.current) {
        heatRef.current.setMap(null)
        heatRef.current = null
      }
      for (const o of suburbOverlaysRef.current) o.setMap(null)
      suburbOverlaysRef.current = []
      mapRef.current = null
      initialFitRef.current = false
      setReady(false)
    }
  // Loader runs once per mount; fallbackCenter changes are handled in the
  // payload-sync effect via fitBounds / setCenter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Sync property pins (with optional clustering) on payload change ─────
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const map = mapRef.current
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const G = (window as any).google as typeof google

    // Tear down previous markers + clusterer.
    if (clustererRef.current) {
      clustererRef.current.clearMarkers()
      clustererRef.current = null
    }
    for (const m of markersRef.current) m.map = null
    markersRef.current = []

    const props = payload?.properties ?? []
    const plottable = props.filter((p): p is PropertySignal & { lat: number; lng: number } =>
      typeof p.lat === 'number' && typeof p.lng === 'number',
    )

    // HOR-220 tab order: hot → active → quiet within visible bounds (DOM
    // insertion order controls Tab traversal in AdvancedMarkerElement panes).
    // Paint order (hot on top) is preserved independently via marker.zIndex —
    // see brief: "tab order goes hot → active → quiet within visible bounds".
    const tabOrder:  Record<PropertyState, number> = { hot: 0, active: 1, quiet: 2 }
    const paintZIdx: Record<PropertyState, number> = { quiet: 1, active: 2, hot: 3 }
    const sorted = [...plottable].sort((a, b) => tabOrder[a.state] - tabOrder[b.state])
    const markers = sorted.map((p) => {
      const marker = new G.maps.marker.AdvancedMarkerElement({
        position: { lat: p.lat, lng: p.lng },
        content: pinElement(p),
        title:   p.address,
        zIndex:  paintZIdx[p.state],
      })
      marker.addListener('click', () => {
        if (typeof window === 'undefined') return
        // Hash routing — the slide-in SignalPanel (HOR-219) listens for it.
        const url = new URL(window.location.href)
        url.hash = `signal=${encodeURIComponent(p.id)}`
        window.location.replace(url.toString())
      })
      return marker
    })
    markersRef.current = markers

    // Cluster only when the visible pin count crosses the brief's threshold.
    // Below it, attach markers directly to the map so each pin reads on its own.
    if (markers.length >= CLUSTER_THRESHOLD) {
      clustererRef.current = new MarkerClusterer({
        map,
        markers,
        renderer: { render: (cluster, stats) => clusterRenderer(cluster, stats, map) },
      })
    } else {
      for (const m of markers) m.map = map
    }

    // First payload after mount: fit the map to the active pins so the agent
    // lands on something meaningful. Subsequent payloads (scrubber clicks)
    // preserve the user's zoom + pan.
    if (!initialFitRef.current && plottable.length > 0) {
      const bounds = new G.maps.LatLngBounds()
      for (const p of plottable) bounds.extend({ lat: p.lat, lng: p.lng })
      if (plottable.length === 1) {
        map.setCenter({ lat: plottable[0].lat, lng: plottable[0].lng })
        map.setZoom(15)
      } else {
        map.fitBounds(bounds, 64)
      }
      initialFitRef.current = true
    }
  }, [ready, payload?.properties])

  // ── Sync heat layer ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const map = mapRef.current
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const G = (window as any).google as typeof google

    if (heatRef.current) {
      heatRef.current.setMap(null)
      heatRef.current = null
    }
    const heat = payload?.heat ?? []
    if (heat.length === 0) return

    const data = heat.map((c) => ({
      location: new G.maps.LatLng(c.lat, c.lng),
      // Brief: weight the heat layer by intensity, not point count.
      weight: c.intensity,
    }))

    const layer = new G.maps.visualization.HeatmapLayer({
      data,
      map,
      radius:  heatRadiusForZoom(map.getZoom() ?? 13),
      opacity: 0.6,
      // Brief: transparent → warm cream → soft orange → deeper orange.
      gradient: [
        'rgba(196,98,45,0)',
        'rgba(239,231,215,0.4)',
        'rgba(196,98,45,0.5)',
        'rgba(196,98,45,0.9)',
      ],
      maxIntensity: 1.0, // payload intensities are already normalised 0..1
      dissipating: true,
    })
    heatRef.current = layer
  }, [ready, payload?.heat])

  // ── Sync suburb labels ──────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const map = mapRef.current
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const G = (window as any).google as typeof google

    // Tear down previous overlays.
    for (const o of suburbOverlaysRef.current) o.setMap(null)
    suburbOverlaysRef.current = []

    const suburbs = payload?.suburbs ?? []
    const initialOpacity = suburbLabelOpacityForZoom(map.getZoom() ?? 13)

    // Custom OverlayView class — defined per-effect so it closes over the
    // live `G` reference, avoiding the SSR-vs-runtime google-undefined trap.
    class SuburbLabelOverlay extends G.maps.OverlayView {
      private dom: HTMLElement | null = null
      constructor(private suburb: SuburbSignal) { super() }

      // For the zoom-change handler to read.
      getDom(): HTMLElement | null { return this.dom }

      onAdd() {
        const dom = suburbLabelDom(this.suburb)
        dom.style.opacity = String(initialOpacity)
        dom.style.transition = 'opacity 220ms ease-out'

        // Click → pan + zoom to the suburb centroid. HOR-245 dropped the
        // suburb side panel (v2 only has a property overlay); suburb-label
        // interactions are now a navigation aid only. Quiet suburbs aren't
        // interactive — they read as cartography.
        if (this.suburb.state !== 'quiet') {
          dom.addEventListener('click', (e) => {
            e.stopPropagation()
            if (this.suburb.lat == null || this.suburb.lng == null) return
            const target = new G.maps.LatLng(this.suburb.lat, this.suburb.lng)
            map.panTo(target)
            // Zoom in one street-level step; cap at 16 so we don't blow
            // past the heat layer's resolution.
            const next = Math.min(16, (map.getZoom() ?? 13) + 2)
            map.setZoom(next)
          })
        }

        this.dom = dom
        const panes = this.getPanes()
        // floatPane sits above markers; suburb labels read as cartography.
        panes?.floatPane.appendChild(dom)
      }

      draw() {
        if (!this.dom) return
        const projection = this.getProjection()
        if (!projection) return
        if (this.suburb.lat == null || this.suburb.lng == null) {
          // No GNAF centroid — hide rather than place at (0,0).
          this.dom.style.display = 'none'
          return
        }
        const pt = projection.fromLatLngToDivPixel(
          new G.maps.LatLng(this.suburb.lat, this.suburb.lng),
        )
        if (pt) {
          this.dom.style.display = ''
          this.dom.style.left = `${pt.x}px`
          this.dom.style.top  = `${pt.y}px`
        }
      }

      onRemove() {
        if (this.dom && this.dom.parentNode) {
          this.dom.parentNode.removeChild(this.dom)
        }
        this.dom = null
      }
    }

    // Render order: quiet first so warm/hot/stirring labels paint on top.
    const stateOrder: Record<SuburbState, number> = { quiet: 0, warm: 1, hot: 2, stirring: 3 }
    const sorted = [...suburbs].sort((a, b) => stateOrder[a.state] - stateOrder[b.state])

    for (const s of sorted) {
      const overlay = new SuburbLabelOverlay(s)
      overlay.setMap(map)
      suburbOverlaysRef.current.push(overlay)
    }
  }, [ready, payload?.suburbs])

  // ── Degraded states ─────────────────────────────────────────────────────

  if (degraded) {
    return (
      <div
        style={{
          height: 540,
          background: COLOR.parchment,
          border: '1px solid rgba(140,123,107,0.22)',
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: COLOR.stone,
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          textAlign: 'center',
          padding: 32,
        }}
      >
        <div>
          <MapPin style={{ width: 32, height: 32, opacity: 0.4, marginBottom: 12 }} />
          <div>{degraded}</div>
        </div>
      </div>
    )
  }

  // HOR-220: meaningful aria-label that recomputes on every payload change.
  // Screen-reader users without map access still get "what's in here" at a
  // glance. Empty payload → short empty-state label.
  const mapAriaLabel = payload
    ? composeMapAriaLabel(payload)
    : 'Property signal map'

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={hostRef}
        role="application"
        aria-label={mapAriaLabel}
        style={{
          height: 540,
          width: '100%',
          background: COLOR.parchment,
          border: '1px solid rgba(140,123,107,0.22)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      />
      {payload && payload.properties.length === 0 && payload.heat.length === 0 && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            padding: '8px 12px',
            background: 'rgba(26, 22, 18, 0.78)',
            color: COLOR.parchment,
            fontSize: 12,
            fontFamily: 'var(--font-body)',
            borderRadius: 6,
          }}
        >
          Horace is watching. Nothing stirring yet.
        </div>
      )}
    </div>
  )
}

// ─── A11y helpers ───────────────────────────────────────────────────────────

const WINDOW_LABEL_FOR_ARIA: Record<MapPayload['timeWindow'], string> = {
  '24h': 'today',
  '7d':  'this week',
  '30d': 'this month',
}

function composeMapAriaLabel(p: MapPayload): string {
  const window = WINDOW_LABEL_FOR_ARIA[p.timeWindow]
  const { warm, active, stirring } = p.counters
  const parts: string[] = ['Property signal map', window]
  parts.push(`${active} active ${active === 1 ? 'listing' : 'listings'}`)
  if (stirring > 0) {
    parts.push(`${stirring} ${stirring === 1 ? 'suburb' : 'suburbs'} stirring`)
  } else if (warm > 0) {
    parts.push(`${warm} ${warm === 1 ? 'suburb' : 'suburbs'} warm`)
  } else if (active === 0) {
    parts.push('no signal in this window')
  }
  return parts.join(', ')
}
