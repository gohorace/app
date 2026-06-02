'use client'

/**
 * Properties map — Google Maps signal layer (HOR-218 base, HOR-370 hero re-skin).
 *
 * Consumes the `MapPayload` from `/api/properties/map-payload` (HOR-216) and
 * renders the market substrate on top of a warm parchment basemap. The
 * `/market` view (`components/market/market-view.tsx`) frames it full-bleed and
 * drives the two-state zoom (city ↔ neighbourhood) + selection through props/hash.
 *
 * Basemap styling: applied in code via the inline `styles` array below. We do
 * NOT set a `mapId` — a Map ID would (a) require Cloud-console setup and (b)
 * make Google ignore `styles`. Dropping the mapId means pins render as custom
 * `OverlayView` DOM (not AdvancedMarkerElement, which requires a mapId) — same
 * DOM-rich treatment (hover ring, address chip, selection, keyboard a11y) the
 * suburb labels already use.
 *
 * Layers:
 *   1. **City choropleth (HOR-369).** At city zoom, suburb boundary polygons
 *      (`payload.boundaries`) load into the Google **Data layer**, filled
 *      terracotta with opacity ∝ the joined `SuburbSignal.intensity` (cap
 *      0.85 × `heatOpacity`). Clickable where intensity > 0.10 → `#suburb=<id>`.
 *   2. **Radial heat.** At neighbourhood zoom, the terracotta HeatmapLayer.
 *   3. **Suburb labels** as `OverlayView` DOM at the GNAF centroid.
 *   4. **Property pins** as `OverlayView` DOM in three editorial ink tiers, with
 *      an address-label chip on hover/select and a terracotta selection ring.
 *
 * Click → hash: a pin writes `#signal=<id>`; a suburb polygon/label writes
 * `#suburb=<id>`; an empty-map click clears either.
 */

import { useEffect, useRef, useState } from 'react'
import { Loader } from '@googlemaps/js-api-loader'
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

// No clusterer (it needs AdvancedMarkerElement/Marker, which need a mapId).
// Pins are OverlayView DOM; cap the rendered count by intensity so a very
// dense window can't spawn thousands of DOM nodes. Surfaced, never silent.
const MAX_PINS = 600

// Two curated Google zoom levels for the city ↔ neighbourhood toggle.
const CITY_ZOOM = 11
const NEIGH_ZOOM = 15

/** The market's two-state zoom mode. City = choropleth read; neigh = pins. */
export type ZoomMode = 'city' | 'neigh'

// ─── Palette (matches design tokens used elsewhere in the dashboard) ────────
const COLOR = {
  terracotta:  '#C4622D',
  ink:         '#1A1612',
  parchment:   '#FAF7F2',
  stone:       '#8C7B6B',
}

// ─── Warm parchment basemap style (HOR-370) ─────────────────────────────────
// Flat parchment land, white streets w/ stone casing, POIs + transit stripped,
// muted parks + water, and Google's own admin/locality labels off (we render
// editorial Playfair suburb labels ourselves — don't double them up). The
// terracotta "wash" in the design is the HeatmapLayer, not the basemap.
// Version-controlled twin: docs/market-map-style.md.
const HORACE_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#EFE7D7' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8C7B6B' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#EFE7D7' }, { weight: 2 }] },

  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.locality', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.province', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.country', elementType: 'labels', stylers: [{ visibility: 'off' }] },

  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#C9D2BD' }, { visibility: 'on' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#7C8A72' }] },

  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#EFE7D7' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#EFE7D7' }] },

  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#FBF8F3' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#E2D8C8' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9C8E7D' }] },
  { featureType: 'road', elementType: 'labels.text.stroke', stylers: [{ color: '#FBF8F3' }, { weight: 2 }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#E2D8C8' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.arterial', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },

  { featureType: 'transit', stylers: [{ visibility: 'off' }] },

  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#CFC3B0' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#9C8E7D' }] },
  { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#CFC3B0' }, { weight: 2 }] },
]

// ─── Property pins — three editorial ink tiers (HOR-370 design spec) ────────
// Tiers by intensity: hot ≥0.65, active ≥0.25, quiet <0.25. Pins are INK (not
// terracotta — that reads as cartography); the warmth is the halo on hot pins
// + the heat layer beneath. SVG sizes leave room for the hot halo.

function tierFor(intensity: number): PropertyState {
  if (intensity >= 0.65) return 'hot'
  if (intensity >= 0.25) return 'active'
  return 'quiet'
}

function pinSvg(intensity: number): string {
  const i = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0
  const tier = tierFor(i)

  if (tier === 'hot') {
    return `
      <svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
        <circle cx="24" cy="24" r="20" fill="${COLOR.terracotta}" opacity="0.12"/>
        <circle cx="24" cy="24" r="12" fill="none" stroke="${COLOR.ink}" stroke-width="1.4" opacity="0.9"/>
        <circle cx="24" cy="24" r="6.5" fill="${COLOR.ink}"/>
        <circle cx="22.57" cy="22.57" r="2.08" fill="rgba(250,247,242,0.45)"/>
      </svg>`
  }
  if (tier === 'active') {
    return `
      <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="8" fill="none" stroke="${COLOR.ink}" stroke-width="0.9" opacity="0.5"/>
        <circle cx="16" cy="16" r="4.5" fill="${COLOR.ink}"/>
      </svg>`
  }
  return `
    <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="3" fill="${COLOR.ink}" opacity="0.55"/>
    </svg>`
}

/**
 * Resolve the pin wrapper's ring + address label from its dataset flags so
 * selection (solid terracotta) and hover/focus (soft terracotta) compose
 * without clobbering each other. Selection wins.
 */
function applyPinRing(wrap: HTMLElement) {
  const selected = wrap.dataset.selected === 'true'
  const hovered = wrap.dataset.hovered === 'true'
  if (selected) {
    wrap.style.boxShadow = '0 0 0 2px #C4622D, 0 0 0 5px rgba(196,98,45,0.22)'
  } else if (hovered) {
    wrap.style.boxShadow = '0 0 0 3px rgba(196,98,45,0.32)'
  } else {
    wrap.style.boxShadow = 'none'
  }
  // Address label rides along with the ring — shown on hover/focus + when
  // selected. (Labelling every pin at once would clutter dense markets; the
  // design's all-labelled look assumed a sparse curated set.)
  const label = wrap.querySelector('[data-pin-label]') as HTMLElement | null
  if (label) label.style.display = selected || hovered ? 'block' : 'none'
}

function pinElement(p: PropertySignal): HTMLElement {
  // HOR-220 a11y: the visual SVG can be small (quiet tier), but the
  // hit/focus target must be ≥ 24px (WCAG 2.5.5). Wrapper is a fixed 32×32
  // box with the SVG centred; the hot halo overflows it harmlessly.
  const wrap = document.createElement('div')
  wrap.style.cursor = 'pointer'
  wrap.style.position = 'relative'
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
  wrap.setAttribute('aria-label', `${p.address} — ${p.state} signal`)

  // Address label chip (design) — cream pill to the right of the dot. Hidden
  // until hover/focus/select (toggled in applyPinRing); pointer-events off so
  // it never steals the pin's click/hit target.
  const label = document.createElement('span')
  label.setAttribute('data-pin-label', '')
  label.textContent = p.address
  label.style.cssText = [
    'display:none',
    'position:absolute',
    'left:calc(50% + 12px)',
    'top:50%',
    'transform:translateY(-50%)',
    'white-space:nowrap',
    'pointer-events:none',
    'padding:2px 7px',
    'background:rgba(250,247,242,0.95)',
    'border:1px solid rgba(140,123,107,0.25)',
    'border-radius:5px',
    'font-family:var(--font-body)',
    'font-size:11px',
    'font-weight:500',
    'color:#1A1612',
    'box-shadow:0 1px 3px rgba(26,22,18,0.12)',
    'z-index:1',
  ].join(';')
  wrap.appendChild(label)

  const show = () => { wrap.dataset.hovered = 'true'; applyPinRing(wrap) }
  const hide = () => { wrap.dataset.hovered = 'false'; applyPinRing(wrap) }
  wrap.addEventListener('mouseenter', show)
  wrap.addEventListener('mouseleave', hide)
  wrap.addEventListener('focus', show)
  wrap.addEventListener('blur', hide)
  // Keyboard activation parity with click.
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
//   quiet    — DM Mono 10/400, faded grey (non-interactive cartography)
//   warm     — Playfair 11/600
//   hot      — Playfair 12/700 (strongest read)
//   stirring — Playfair 11/600 italic terracotta + pulsing dot (gated)

function suburbLabelDom(s: SuburbSignal, showStirring: boolean): HTMLElement {
  const wrap = document.createElement('div')
  wrap.style.position = 'absolute'
  wrap.style.transform = 'translate(-50%, -50%)'
  wrap.style.pointerEvents = s.state === 'quiet' ? 'none' : 'auto'
  wrap.style.cursor = s.state === 'quiet' ? 'default' : 'pointer'
  wrap.style.userSelect = 'none'
  wrap.style.whiteSpace = 'nowrap'
  // HOR-220 a11y: padding gives a ≥24px tap target.
  wrap.style.padding = '6px 8px'
  wrap.style.borderRadius = '4px'
  wrap.style.outline = 'none'
  wrap.setAttribute('data-suburb-state', s.state)
  if (s.state !== 'quiet') {
    wrap.tabIndex = 0
    wrap.setAttribute('role', 'button')
    wrap.setAttribute('aria-label', `${s.name ?? 'Suburb'} — ${s.state} suburb signal`)
    const showRing = () => { wrap.style.boxShadow = '0 0 0 3px rgba(196,98,45,0.22)' }
    const hideRing = () => { wrap.style.boxShadow = 'none' }
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

  // Stirring suffix — animated terracotta dot with two ring pulses. Gated by
  // the showStirring prop (design's tweak harness).
  if (s.state === 'stirring' && showStirring) {
    const dotWrap = document.createElement('span')
    dotWrap.style.position = 'relative'
    dotWrap.style.display = 'inline-block'
    dotWrap.style.width = '14px'
    dotWrap.style.height = '14px'
    dotWrap.style.marginLeft = '6px'
    dotWrap.style.verticalAlign = 'middle'

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

    for (const cls of ['horace-stir-a', 'horace-stir-b']) {
      const ring = document.createElement('span')
      ring.style.position = 'absolute'
      ring.style.left = '50%'
      ring.style.top  = '50%'
      ring.style.width = '14px'
      ring.style.height = '14px'
      ring.style.borderRadius = '50%'
      ring.style.border = `1px solid ${COLOR.terracotta}`
      ring.style.transform = 'translate(-50%, -50%) scale(0.4)'
      ring.className = `horace-stir-ring ${cls}`
      dotWrap.appendChild(ring)
    }

    wrap.appendChild(dotWrap)
  }

  return wrap
}

// Injected once per page lifetime. Two-phase terracotta pulse on the stirring
// dot — matches the design's `stir-label-pulse` (2200ms, 2nd ring +1100ms).
function ensureStirringKeyframes() {
  if (typeof document === 'undefined') return
  if (document.getElementById('horace-stir-keyframes')) return
  const style = document.createElement('style')
  style.id = 'horace-stir-keyframes'
  style.textContent = `
    @keyframes horace-stir-pulse {
      0%   { transform: translate(-50%, -50%) scale(0.4); opacity: 0.85; }
      100% { transform: translate(-50%, -50%) scale(2.4); opacity: 0;    }
    }
    .horace-stir-ring {
      animation: horace-stir-pulse 2200ms cubic-bezier(0.16, 1, 0.3, 1) infinite;
    }
    .horace-stir-ring.horace-stir-b {
      animation-delay: 1100ms;
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

/** Suburb labels are primary at city zoom, recede only slightly at street zoom
 *  (the design keeps the editorial suburb names readable in the neigh read). */
function suburbLabelOpacityForZoom(z: number): number {
  if (z < 12) return 1
  if (z <= 14) return 0.85
  return 0.6
}

// ─── Component ──────────────────────────────────────────────────────────────

interface Props {
  payload:         MapPayload | null
  fallbackCenter?: { lat: number; lng: number } | null
  /**
   * Fill the parent container's height instead of the default fixed 540px.
   * `/market` renders the map full-bleed and passes `fill`.
   */
  fill?:           boolean
  /** Two-state zoom mode (HOR-370). City = choropleth; neigh = radial heat + pins. */
  zoomMode?:       ZoomMode
  /** The currently-selected pin id — gets a terracotta selection ring. */
  selectedPinId?:  string | null
  /** Global heat opacity multiplier (design tweak; default 0.6). */
  heatOpacity?:    number
  /** Whether stirring suburb labels pulse (design tweak; default true). */
  showStirring?:   boolean
}

export function PropertiesMap({
  payload,
  fallbackCenter = null,
  fill = false,
  zoomMode = 'neigh',
  selectedPinId = null,
  heatOpacity = 0.6,
  showStirring = true,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const pinOverlaysRef = useRef<google.maps.OverlayView[]>([])
  const pinElsRef = useRef<Map<string, HTMLElement>>(new Map())
  const heatRef = useRef<google.maps.visualization.HeatmapLayer | null>(null)
  const suburbOverlaysRef = useRef<google.maps.OverlayView[]>([])
  const initialFitRef = useRef(false)
  const zoomModeInitRef = useRef(false)
  const [degraded, setDegraded] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [pinNote, setPinNote] = useState<string | null>(null)

  // ── Mount: load Maps + visualization libs, create the styled map ────────
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
      loader.importLibrary('visualization'),
    ])
      .then(([mapsLib]) => {
        if (cancelled || !hostRef.current) return
        const { Map: GMap } = mapsLib as google.maps.MapsLibrary

        const initialCenter = fallbackCenter ?? HORACE_HQ_FALLBACK
        const map = new GMap(hostRef.current, {
          center: initialCenter,
          zoom: NEIGH_ZOOM,
          // No mapId: it would make Google ignore `styles` (and we don't use
          // AdvancedMarkerElement — pins are OverlayView DOM). See header.
          styles: HORACE_MAP_STYLE,
          disableDefaultUI: true, // /market floats its own glass controls
          clickableIcons: false,
        })
        mapRef.current = map

        // Heat-radius + suburb-label opacity follow the live zoom band.
        map.addListener('zoom_changed', () => {
          const z = map.getZoom() ?? NEIGH_ZOOM
          if (heatRef.current) heatRef.current.set('radius', heatRadiusForZoom(z))
          const op = suburbLabelOpacityForZoom(z)
          for (const ov of suburbOverlaysRef.current) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const dom = (ov as any).getDom?.() as HTMLElement | undefined
            if (dom) dom.style.opacity = String(op)
          }
        })

        // Empty-map click → clear any open panel by clearing the hash.
        map.addListener('click', () => {
          if (typeof window === 'undefined') return
          if (window.location.hash.startsWith('#signal=') || window.location.hash.startsWith('#suburb=')) {
            history.replaceState(null, '', window.location.pathname + window.location.search)
            window.dispatchEvent(new HashChangeEvent('hashchange'))
          }
        })

        // City choropleth click → open the suburb panel. Listener attached
        // once; features are added/removed per zoom mode below. Gated to
        // intensity > 0.10 (matches the design's hit-target rule).
        map.data.addListener('click', (e: google.maps.Data.MouseEvent) => {
          if (typeof window === 'undefined') return
          const id = e.feature.getProperty('id') as string | undefined
          const intensity = Number(e.feature.getProperty('intensity')) || 0
          if (!id || intensity <= 0.10) return
          const url = new URL(window.location.href)
          url.hash = `suburb=${encodeURIComponent(id)}`
          window.location.replace(url.toString())
        })

        setReady(true)
      })
      .catch((err) => {
        console.error('[properties-map] loader failed', err)
        setDegraded('Map view is unavailable right now.')
      })

    return () => {
      cancelled = true
      for (const o of pinOverlaysRef.current) o.setMap(null)
      pinOverlaysRef.current = []
      pinElsRef.current.clear()
      if (heatRef.current) {
        heatRef.current.setMap(null)
        heatRef.current = null
      }
      for (const o of suburbOverlaysRef.current) o.setMap(null)
      suburbOverlaysRef.current = []
      mapRef.current = null
      initialFitRef.current = false
      zoomModeInitRef.current = false
      setReady(false)
    }
  // Loader runs once per mount; prop changes handled in the sync effects.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Two-state zoom. The initial camera is owned by the pin fit below; this
  //   only fires on an actual mode toggle.
  useEffect(() => {
    if (!ready || !mapRef.current) return
    if (!zoomModeInitRef.current) {
      zoomModeInitRef.current = true
      return
    }
    mapRef.current.setZoom(zoomMode === 'city' ? CITY_ZOOM : NEIGH_ZOOM)
  }, [ready, zoomMode])

  // ── Sync property pins (OverlayView DOM) on payload change ───────────────
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const map = mapRef.current
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const G = (window as any).google as typeof google

    for (const o of pinOverlaysRef.current) o.setMap(null)
    pinOverlaysRef.current = []
    pinElsRef.current.clear()

    const props = payload?.properties ?? []
    const plottable = props.filter((p): p is PropertySignal & { lat: number; lng: number } =>
      typeof p.lat === 'number' && typeof p.lng === 'number',
    )

    // Cap rendered pins by intensity (no silent truncation — surfaced below).
    let render = plottable
    if (plottable.length > MAX_PINS) {
      render = [...plottable].sort((a, b) => b.intensity - a.intensity).slice(0, MAX_PINS)
      console.warn(
        `[properties-map] ${plottable.length} plottable pins; rendering the strongest ${MAX_PINS}.`,
      )
      setPinNote(`Showing the ${MAX_PINS} strongest of ${plottable.length} signals — zoom in for the rest.`)
    } else {
      setPinNote(null)
    }

    // HOR-220 tab order: hot → active → quiet (DOM insertion order). Paint
    // order (hot on top) is controlled independently via the positioner zIndex.
    const tabOrder:  Record<PropertyState, number> = { hot: 0, active: 1, quiet: 2 }
    const paintZIdx: Record<PropertyState, number> = { quiet: 1, active: 2, hot: 3 }
    const sorted = [...render].sort((a, b) => tabOrder[a.state] - tabOrder[b.state])

    class PinOverlay extends G.maps.OverlayView {
      private positioner: HTMLElement | null = null
      constructor(private p: PropertySignal & { lat: number; lng: number }) { super() }

      onAdd() {
        const el = pinElement(this.p)
        pinElsRef.current.set(this.p.id, el)
        // Re-apply the selection ring in case this pin is the current selection
        // (onAdd can run after the selection effect on a fresh payload).
        el.dataset.selected = this.p.id === selectedPinId ? 'true' : 'false'
        applyPinRing(el)
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          if (typeof window === 'undefined') return
          const url = new URL(window.location.href)
          url.hash = `signal=${encodeURIComponent(this.p.id)}`
          window.location.replace(url.toString())
        })

        const pos = document.createElement('div')
        pos.style.position = 'absolute'
        pos.style.transform = 'translate(-50%, -50%)'
        pos.style.zIndex = String(paintZIdx[this.p.state])
        pos.appendChild(el)
        this.positioner = pos
        // overlayMouseTarget receives DOM events → pins stay clickable/focusable.
        this.getPanes()?.overlayMouseTarget.appendChild(pos)
      }

      draw() {
        if (!this.positioner) return
        const projection = this.getProjection()
        if (!projection) return
        const pt = projection.fromLatLngToDivPixel(
          new G.maps.LatLng(this.p.lat, this.p.lng),
        )
        if (pt) {
          this.positioner.style.left = `${pt.x}px`
          this.positioner.style.top  = `${pt.y}px`
        }
      }

      onRemove() {
        if (this.positioner && this.positioner.parentNode) {
          this.positioner.parentNode.removeChild(this.positioner)
        }
        this.positioner = null
      }
    }

    for (const p of sorted) {
      const overlay = new PinOverlay(p)
      overlay.setMap(map)
      pinOverlaysRef.current.push(overlay)
    }

    // First payload after mount: fit to the active pins.
    if (!initialFitRef.current && plottable.length > 0) {
      const bounds = new G.maps.LatLngBounds()
      for (const p of plottable) bounds.extend({ lat: p.lat, lng: p.lng })
      if (plottable.length === 1) {
        map.setCenter({ lat: plottable[0].lat, lng: plottable[0].lng })
        map.setZoom(NEIGH_ZOOM)
      } else {
        map.fitBounds(bounds, 64)
      }
      initialFitRef.current = true
    }
  }, [ready, payload?.properties]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Selection ring — toggle the terracotta ring on the selected pin
  //   without rebuilding overlays.
  useEffect(() => {
    if (!ready) return
    for (const [id, el] of pinElsRef.current) {
      el.dataset.selected = id === selectedPinId ? 'true' : 'false'
      applyPinRing(el)
    }
  }, [ready, selectedPinId, payload?.properties])

  // ── Sync radial heat layer (neighbourhood zoom only) ────────────────────
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const map = mapRef.current
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const G = (window as any).google as typeof google

    if (heatRef.current) {
      heatRef.current.setMap(null)
      heatRef.current = null
    }
    // City zoom uses the choropleth instead of radial clouds.
    if (zoomMode === 'city') return

    const heat = payload?.heat ?? []
    if (heat.length === 0) return

    const data = heat.map((c) => ({
      location: new G.maps.LatLng(c.lat, c.lng),
      weight: c.intensity,
    }))

    const layer = new G.maps.visualization.HeatmapLayer({
      data,
      map,
      radius:  heatRadiusForZoom(map.getZoom() ?? NEIGH_ZOOM),
      opacity: heatOpacity,
      gradient: [
        'rgba(196,98,45,0)',
        'rgba(239,231,215,0.4)',
        'rgba(196,98,45,0.5)',
        'rgba(196,98,45,0.9)',
      ],
      maxIntensity: 1.0,
      dissipating: true,
    })
    heatRef.current = layer
  }, [ready, payload?.heat, zoomMode, heatOpacity])

  // ── Sync city choropleth (HOR-369 boundaries via the Data layer) ────────
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const map = mapRef.current

    // Always start from a clean slate, then repopulate only at city zoom.
    map.data.forEach((f) => map.data.remove(f))
    if (zoomMode !== 'city') return

    const boundaries = payload?.boundaries ?? []
    if (boundaries.length === 0) return

    // Join boundary → suburb signal by id to drive fill opacity + clickability.
    const signalById = new Map((payload?.suburbs ?? []).map((s) => [s.id, s]))

    map.data.addGeoJson({
      type: 'FeatureCollection',
      features: boundaries.map((b) => ({
        type: 'Feature',
        id: b.id,
        geometry: b.geometry,
        properties: {
          id: b.id,
          intensity: signalById.get(b.id)?.intensity ?? 0,
        },
      })),
    })

    map.data.setStyle((feature) => {
      const intensity = Number(feature.getProperty('intensity')) || 0
      const interactive = intensity > 0.10
      // Per the design: opacity ∝ intensity, capped 0.85, scaled by the
      // global heat multiplier. (Data layer can't do the multiply-blend
      // wash natively — this is the documented fidelity trade-off.)
      const fillOpacity = Math.min(0.85, intensity * 0.85) * heatOpacity
      return {
        fillColor: COLOR.terracotta,
        fillOpacity,
        strokeColor: COLOR.terracotta,
        strokeWeight: interactive ? 0.8 : 0.4,
        strokeOpacity: 0.32,
        clickable: interactive,
        cursor: interactive ? 'pointer' : undefined,
        zIndex: 1,
      }
    })
  }, [ready, payload?.boundaries, payload?.suburbs, zoomMode, heatOpacity])

  // ── Sync suburb labels ──────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const map = mapRef.current
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const G = (window as any).google as typeof google

    for (const o of suburbOverlaysRef.current) o.setMap(null)
    suburbOverlaysRef.current = []

    const suburbs = payload?.suburbs ?? []
    const initialOpacity = suburbLabelOpacityForZoom(map.getZoom() ?? NEIGH_ZOOM)

    class SuburbLabelOverlay extends G.maps.OverlayView {
      private dom: HTMLElement | null = null
      constructor(private suburb: SuburbSignal) { super() }

      getDom(): HTMLElement | null { return this.dom }

      onAdd() {
        const dom = suburbLabelDom(this.suburb, showStirring)
        dom.style.opacity = String(initialOpacity)
        dom.style.transition = 'opacity 220ms ease-out'

        // HOR-370: a suburb label click opens the suburb detail panel
        // (re-added; HOR-245 had dropped it for a pan/zoom nav aid). Quiet
        // suburbs aren't interactive — they read as cartography.
        if (this.suburb.state !== 'quiet') {
          dom.addEventListener('click', (e) => {
            e.stopPropagation()
            const url = new URL(window.location.href)
            url.hash = `suburb=${encodeURIComponent(this.suburb.id)}`
            window.location.replace(url.toString())
          })
        }

        this.dom = dom
        const panes = this.getPanes()
        panes?.floatPane.appendChild(dom)
      }

      draw() {
        if (!this.dom) return
        const projection = this.getProjection()
        if (!projection) return
        if (this.suburb.lat == null || this.suburb.lng == null) {
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

    const stateOrder: Record<SuburbState, number> = { quiet: 0, warm: 1, hot: 2, stirring: 3 }
    const sorted = [...suburbs].sort((a, b) => stateOrder[a.state] - stateOrder[b.state])

    for (const s of sorted) {
      const overlay = new SuburbLabelOverlay(s)
      overlay.setMap(map)
      suburbOverlaysRef.current.push(overlay)
    }
  }, [ready, payload?.suburbs, showStirring])

  // ── Degraded states ─────────────────────────────────────────────────────

  if (degraded) {
    return (
      <div
        style={{
          height: fill ? '100%' : 540,
          background: COLOR.parchment,
          border: fill ? 'none' : '1px solid rgba(140,123,107,0.22)',
          borderRadius: fill ? 0 : 10,
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

  const mapAriaLabel = payload
    ? composeMapAriaLabel(payload)
    : 'Property signal map'

  return (
    <div style={{ position: 'relative', height: fill ? '100%' : undefined }}>
      <div
        ref={hostRef}
        role="application"
        aria-label={mapAriaLabel}
        style={{
          height: fill ? '100%' : 540,
          width: '100%',
          background: COLOR.parchment,
          border: fill ? 'none' : '1px solid rgba(140,123,107,0.22)',
          borderRadius: fill ? 0 : 10,
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
      {pinNote && (
        <div
          style={{
            position: 'absolute',
            bottom: 14,
            left: 14,
            padding: '7px 11px',
            background: 'rgba(250,247,242,0.92)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            border: '1px solid rgba(140,123,107,0.22)',
            color: '#5E5246',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            borderRadius: 7,
            maxWidth: 260,
            lineHeight: 1.4,
          }}
        >
          {pinNote}
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
