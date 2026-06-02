'use client'

/**
 * Properties map — Google Maps signal layer (HOR-218 base, HOR-370 hero re-skin).
 *
 * Consumes the `MapPayload` from `/api/properties/map-payload` (HOR-216) and
 * renders the market substrate on a warm parchment basemap. The `/market` view
 * (`components/market/market-view.tsx`) frames it full-bleed and drives zoom via
 * the imperative handle; selection flows through props/hash.
 *
 * Basemap styling: applied in code via the inline `styles` array below. We do
 * NOT set a `mapId` (a Map ID would make Google ignore `styles`, and needs
 * Cloud-console setup). Consequence: pins are legacy `google.maps.Marker`s
 * (which, unlike AdvancedMarkerElement, don't need a mapId) + `MarkerClusterer`
 * — so a workspace with thousands of properties clusters into density rather
 * than dropping pins.
 *
 * Layers:
 *   1. **City choropleth (HOR-369).** When zoomed out past CITY_MAX_ZOOM, suburb
 *      boundary polygons (`payload.boundaries`) load into the Data layer, filled
 *      terracotta with opacity ∝ joined `SuburbSignal.intensity`. Clickable where
 *      intensity > 0.10 → `#suburb=<id>`.
 *   2. **Radial heat** (HeatmapLayer) when zoomed in.
 *   3. **Suburb labels** (OverlayView) at the GNAF centroid.
 *   4. **Property pins** (Marker + MarkerClusterer) in three ink tiers, with a
 *      terracotta ring + address chip on hover/select.
 *
 * Click → hash: a pin writes `#signal=<id>`; a suburb polygon/label writes
 * `#suburb=<id>`; an empty-map click clears either.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
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

// At/below this Google zoom we read the city (choropleth on, radial heat off);
// above it we read the neighbourhood (pins + radial heat). Derived from the
// live zoom so the +/- buttons and mouse-scroll stay consistent.
const CITY_MAX_ZOOM = 12
const DEFAULT_ZOOM = 15
const MIN_ZOOM = 3
const MAX_ZOOM = 20

/** Imperative handle so `/market`'s glass +/- buttons can nudge the live zoom. */
export interface PropertiesMapHandle {
  zoomBy: (delta: number) => void
}

// ─── Palette (matches design tokens used elsewhere in the dashboard) ────────
const COLOR = {
  terracotta:  '#C4622D',
  ink:         '#1A1612',
  parchment:   '#FAF7F2',
  stone:       '#8C7B6B',
}

// ─── Warm parchment basemap style (HOR-370) ─────────────────────────────────
// Flat parchment land, white streets w/ stone casing, POIs + transit stripped,
// muted parks + water, Google's own admin/locality labels off (we render our
// own editorial labels). The terracotta "wash" is the HeatmapLayer, not the
// basemap. Version-controlled twin: docs/market-map-style.md.
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
// Tiers by intensity: hot ≥0.65, active ≥0.25, quiet <0.25. Pins are INK; the
// warmth is the halo on hot pins + the heat layer beneath. The `ring` variant
// (terracotta) is the hover/selection state. Rendered as Marker icon SVGs.

function tierFor(intensity: number): PropertyState {
  if (intensity >= 0.65) return 'hot'
  if (intensity >= 0.25) return 'active'
  return 'quiet'
}

/** SVG box size per tier (hot leaves room for its halo). */
function pinSize(intensity: number): number {
  return tierFor(intensity) === 'hot' ? 48 : 32
}

function pinSvg(intensity: number, ring: boolean): string {
  const i = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0
  const tier = tierFor(i)
  const ringEl = (cx: number, r: number) =>
    ring ? `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${COLOR.terracotta}" stroke-width="2"/>` : ''

  if (tier === 'hot') {
    return `<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="20" fill="${COLOR.terracotta}" opacity="0.12"/>
      <circle cx="24" cy="24" r="12" fill="none" stroke="${COLOR.ink}" stroke-width="1.4" opacity="0.9"/>
      <circle cx="24" cy="24" r="6.5" fill="${COLOR.ink}"/>
      <circle cx="22.57" cy="22.57" r="2.08" fill="rgba(250,247,242,0.45)"/>
      ${ringEl(24, 15)}
    </svg>`
  }
  if (tier === 'active') {
    return `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="8" fill="none" stroke="${COLOR.ink}" stroke-width="0.9" opacity="0.5"/>
      <circle cx="16" cy="16" r="4.5" fill="${COLOR.ink}"/>
      ${ringEl(16, 11)}
    </svg>`
  }
  return `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <circle cx="16" cy="16" r="3" fill="${COLOR.ink}" opacity="0.55"/>
    ${ringEl(16, 7)}
  </svg>`
}

function pinIcon(G: typeof google, intensity: number, ring: boolean): google.maps.Icon {
  const size = pinSize(intensity)
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(pinSvg(intensity, ring)),
    scaledSize: new G.maps.Size(size, size),
    anchor: new G.maps.Point(size / 2, size / 2),
  }
}

// ─── Suburb label DOM (built per overlay instance) ──────────────────────────
function suburbLabelDom(s: SuburbSignal, showStirring: boolean): HTMLElement {
  const wrap = document.createElement('div')
  wrap.style.position = 'absolute'
  wrap.style.transform = 'translate(-50%, -50%)'
  wrap.style.pointerEvents = s.state === 'quiet' ? 'none' : 'auto'
  wrap.style.cursor = s.state === 'quiet' ? 'default' : 'pointer'
  wrap.style.userSelect = 'none'
  wrap.style.whiteSpace = 'nowrap'
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
    text.style.fontFamily = "'Playfair Display', serif"
    text.style.fontSize = '11px'
    text.style.fontWeight = '600'
    text.style.letterSpacing = '-0.005em'
    text.style.color = 'rgba(26,22,18,0.62)'
  }

  wrap.appendChild(text)

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

function heatRadiusForZoom(z: number): number {
  if (z < 12) return 60
  if (z <= 14) return 35
  return 18
}

function suburbLabelOpacityForZoom(z: number): number {
  if (z < 12) return 1
  if (z <= 14) return 0.85
  return 0.6
}

// ─── Cluster renderer ───────────────────────────────────────────────────────
// Cluster bubble uses the same ink-pin treatment scaled to count (not a
// numbered circle). Returns a legacy Marker (no mapId available).

function clusterRenderer(
  cluster: Cluster,
  _stats: ClusterStats,
  map: google.maps.Map,
  G: typeof google,
): google.maps.Marker {
  const c = cluster.count
  const halo = Math.min(64, Math.max(34, 24 + Math.sqrt(c) * 2.2))
  const dot  = Math.min(20, Math.max(8,  4  + Math.sqrt(c) * 0.7))
  const svg = `<svg width="${halo}" height="${halo}" viewBox="0 0 ${halo} ${halo}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${halo / 2}" cy="${halo / 2}" r="${halo / 2}" fill="${COLOR.terracotta}" opacity="0.14"/>
      <circle cx="${halo / 2}" cy="${halo / 2}" r="${halo * 0.32}" fill="none" stroke="${COLOR.ink}" stroke-width="1.4" opacity="0.85"/>
      <circle cx="${halo / 2}" cy="${halo / 2}" r="${dot / 2}" fill="${COLOR.ink}"/>
    </svg>`

  const marker = new G.maps.Marker({
    position: cluster.position,
    icon: {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new G.maps.Size(halo, halo),
      anchor: new G.maps.Point(halo / 2, halo / 2),
    },
    title: `${c} properties`,
    zIndex: 1000 + c,
  })
  marker.addListener('click', () => {
    if (cluster.bounds) map.fitBounds(cluster.bounds, 64)
  })
  return marker
}

// ─── Component ──────────────────────────────────────────────────────────────

interface Props {
  payload:         MapPayload | null
  fallbackCenter?: { lat: number; lng: number } | null
  fill?:           boolean
  /** The currently-selected pin id — gets a terracotta selection ring. */
  selectedPinId?:  string | null
  /** Global heat opacity multiplier (design tweak; default 0.6). */
  heatOpacity?:    number
  /** Whether stirring suburb labels pulse (design tweak; default true). */
  showStirring?:   boolean
}

interface MarkerRec {
  marker:    google.maps.Marker
  intensity: number
  lat:       number
  lng:       number
  address:   string
}

export const PropertiesMap = forwardRef<PropertiesMapHandle, Props>(function PropertiesMap({
  payload,
  fallbackCenter = null,
  fill = false,
  selectedPinId = null,
  heatOpacity = 0.6,
  showStirring = true,
}: Props, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const clustererRef = useRef<MarkerClusterer | null>(null)
  const markerRecsRef = useRef<Map<string, MarkerRec>>(new Map())
  const labelOverlayRef = useRef<(google.maps.OverlayView & {
    showAt: (text: string, lat: number, lng: number) => void
    hide: () => void
  }) | null>(null)
  const heatRef = useRef<google.maps.visualization.HeatmapLayer | null>(null)
  const suburbOverlaysRef = useRef<google.maps.OverlayView[]>([])
  const initialFitRef = useRef(false)
  const selectedPinIdRef = useRef<string | null>(selectedPinId)
  const [degraded, setDegraded] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  // City vs neighbourhood read, derived from the live zoom (kept in state so
  // the choropleth/heat effects react to it).
  const [cityMode, setCityMode] = useState(false)

  useImperativeHandle(ref, () => ({
    zoomBy(delta: number) {
      const map = mapRef.current
      if (!map) return
      const z = map.getZoom() ?? DEFAULT_ZOOM
      map.setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta)))
    },
  }), [])

  // ── Mount: load Maps + visualization, create the styled map ─────────────
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const G = (window as any).google as typeof google

        const initialCenter = fallbackCenter ?? HORACE_HQ_FALLBACK
        const map = new GMap(hostRef.current, {
          center: initialCenter,
          zoom: DEFAULT_ZOOM,
          styles: HORACE_MAP_STYLE,
          disableDefaultUI: true, // /market floats its own glass controls
          clickableIcons: false,
        })
        mapRef.current = map
        setCityMode((map.getZoom() ?? DEFAULT_ZOOM) <= CITY_MAX_ZOOM)

        // A single shared label chip — follows the hovered/selected pin.
        class LabelOverlay extends G.maps.OverlayView {
          private el: HTMLElement | null = null
          private pos: google.maps.LatLng | null = null
          onAdd() {
            const el = document.createElement('div')
            el.style.cssText = [
              'display:none', 'position:absolute', 'transform:translate(12px,-50%)',
              'white-space:nowrap', 'pointer-events:none', 'padding:2px 7px',
              'background:rgba(250,247,242,0.95)', 'border:1px solid rgba(140,123,107,0.25)',
              'border-radius:5px', 'font-family:var(--font-body)', 'font-size:11px',
              'font-weight:500', 'color:#1A1612', 'box-shadow:0 1px 3px rgba(26,22,18,0.12)',
            ].join(';')
            this.el = el
            this.getPanes()?.floatPane.appendChild(el)
          }
          draw() {
            if (!this.el || !this.pos) return
            const pt = this.getProjection()?.fromLatLngToDivPixel(this.pos)
            if (pt) { this.el.style.left = `${pt.x}px`; this.el.style.top = `${pt.y}px` }
          }
          onRemove() { this.el?.remove(); this.el = null }
          showAt(text: string, lat: number, lng: number) {
            if (this.el) { this.el.textContent = text; this.el.style.display = 'block' }
            this.pos = new G.maps.LatLng(lat, lng)
            this.draw()
          }
          hide() { if (this.el) this.el.style.display = 'none' }
        }
        const label = new LabelOverlay()
        label.setMap(map)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        labelOverlayRef.current = label as any

        map.addListener('zoom_changed', () => {
          const z = map.getZoom() ?? DEFAULT_ZOOM
          if (heatRef.current) heatRef.current.set('radius', heatRadiusForZoom(z))
          setCityMode(z <= CITY_MAX_ZOOM)
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

        // City choropleth click → open the suburb panel (intensity > 0.10).
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
      if (clustererRef.current) {
        clustererRef.current.clearMarkers()
        clustererRef.current = null
      }
      for (const rec of markerRecsRef.current.values()) rec.marker.setMap(null)
      markerRecsRef.current.clear()
      if (labelOverlayRef.current) { labelOverlayRef.current.setMap(null); labelOverlayRef.current = null }
      if (heatRef.current) { heatRef.current.setMap(null); heatRef.current = null }
      for (const o of suburbOverlaysRef.current) o.setMap(null)
      suburbOverlaysRef.current = []
      mapRef.current = null
      initialFitRef.current = false
      setReady(false)
    }
  // Loader runs once per mount; prop changes handled in the sync effects.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Sync property pins (Marker + MarkerClusterer) on payload change ─────
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const map = mapRef.current
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const G = (window as any).google as typeof google

    if (clustererRef.current) {
      clustererRef.current.clearMarkers()
      clustererRef.current = null
    }
    for (const rec of markerRecsRef.current.values()) rec.marker.setMap(null)
    markerRecsRef.current.clear()

    const props = payload?.properties ?? []
    const plottable = props.filter((p): p is PropertySignal & { lat: number; lng: number } =>
      typeof p.lat === 'number' && typeof p.lng === 'number',
    )

    const paintZIdx: Record<PropertyState, number> = { quiet: 1, active: 2, hot: 3 }

    const markers = plottable.map((p) => {
      const marker = new G.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        icon: pinIcon(G, p.intensity, p.id === selectedPinIdRef.current),
        title: p.address,
        zIndex: paintZIdx[p.state],
      })
      markerRecsRef.current.set(p.id, {
        marker, intensity: p.intensity, lat: p.lat, lng: p.lng, address: p.address,
      })
      marker.addListener('click', () => {
        if (typeof window === 'undefined') return
        const url = new URL(window.location.href)
        url.hash = `signal=${encodeURIComponent(p.id)}`
        window.location.replace(url.toString())
      })
      marker.addListener('mouseover', () => {
        marker.setIcon(pinIcon(G, p.intensity, true))
        labelOverlayRef.current?.showAt(p.address, p.lat, p.lng)
      })
      marker.addListener('mouseout', () => {
        marker.setIcon(pinIcon(G, p.intensity, p.id === selectedPinIdRef.current))
        labelOverlayRef.current?.hide()
      })
      return marker
    })

    clustererRef.current = new MarkerClusterer({
      map,
      markers,
      renderer: { render: (cluster, stats) => clusterRenderer(cluster, stats, map, G) },
    })

    // First payload after mount: fit to the active pins.
    if (!initialFitRef.current && plottable.length > 0) {
      const bounds = new G.maps.LatLngBounds()
      for (const p of plottable) bounds.extend({ lat: p.lat, lng: p.lng })
      if (plottable.length === 1) {
        map.setCenter({ lat: plottable[0].lat, lng: plottable[0].lng })
        map.setZoom(DEFAULT_ZOOM)
      } else {
        map.fitBounds(bounds, 64)
      }
      initialFitRef.current = true
    }
  }, [ready, payload?.properties])

  // ── Selection ring — swap the selected marker's icon + show its label.
  useEffect(() => {
    if (!ready) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const G = (window as any).google as typeof google
    selectedPinIdRef.current = selectedPinId
    for (const [id, rec] of markerRecsRef.current) {
      rec.marker.setIcon(pinIcon(G, rec.intensity, id === selectedPinId))
    }
    const sel = selectedPinId ? markerRecsRef.current.get(selectedPinId) : null
    if (sel) labelOverlayRef.current?.showAt(sel.address, sel.lat, sel.lng)
    else labelOverlayRef.current?.hide()
  }, [ready, selectedPinId, payload?.properties])

  // ── Sync radial heat layer (neighbourhood read only) ────────────────────
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const map = mapRef.current
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const G = (window as any).google as typeof google

    if (heatRef.current) { heatRef.current.setMap(null); heatRef.current = null }
    if (cityMode) return

    const heat = payload?.heat ?? []
    if (heat.length === 0) return

    const data = heat.map((c) => ({
      location: new G.maps.LatLng(c.lat, c.lng),
      weight: c.intensity,
    }))

    heatRef.current = new G.maps.visualization.HeatmapLayer({
      data,
      map,
      radius: heatRadiusForZoom(map.getZoom() ?? DEFAULT_ZOOM),
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
  }, [ready, payload?.heat, cityMode, heatOpacity])

  // ── Sync city choropleth (HOR-369 boundaries via the Data layer) ────────
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const map = mapRef.current

    map.data.forEach((f) => map.data.remove(f))
    if (!cityMode) return

    const boundaries = payload?.boundaries ?? []
    if (boundaries.length === 0) return

    const signalById = new Map((payload?.suburbs ?? []).map((s) => [s.id, s]))

    map.data.addGeoJson({
      type: 'FeatureCollection',
      features: boundaries.map((b) => ({
        type: 'Feature',
        id: b.id,
        geometry: b.geometry,
        properties: { id: b.id, intensity: signalById.get(b.id)?.intensity ?? 0 },
      })),
    })

    map.data.setStyle((feature) => {
      const intensity = Number(feature.getProperty('intensity')) || 0
      const interactive = intensity > 0.10
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
  }, [ready, payload?.boundaries, payload?.suburbs, cityMode, heatOpacity])

  // ── Sync suburb labels ──────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const map = mapRef.current
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const G = (window as any).google as typeof google

    for (const o of suburbOverlaysRef.current) o.setMap(null)
    suburbOverlaysRef.current = []

    const suburbs = payload?.suburbs ?? []
    const initialOpacity = suburbLabelOpacityForZoom(map.getZoom() ?? DEFAULT_ZOOM)

    class SuburbLabelOverlay extends G.maps.OverlayView {
      private dom: HTMLElement | null = null
      constructor(private suburb: SuburbSignal) { super() }

      getDom(): HTMLElement | null { return this.dom }

      onAdd() {
        const dom = suburbLabelDom(this.suburb, showStirring)
        dom.style.opacity = String(initialOpacity)
        dom.style.transition = 'opacity 220ms ease-out'

        if (this.suburb.state !== 'quiet') {
          dom.addEventListener('click', (e) => {
            e.stopPropagation()
            const url = new URL(window.location.href)
            url.hash = `suburb=${encodeURIComponent(this.suburb.id)}`
            window.location.replace(url.toString())
          })
        }

        this.dom = dom
        this.getPanes()?.floatPane.appendChild(dom)
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
        if (this.dom && this.dom.parentNode) this.dom.parentNode.removeChild(this.dom)
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

  const mapAriaLabel = payload ? composeMapAriaLabel(payload) : 'Property signal map'

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
    </div>
  )
})

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
