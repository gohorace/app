'use client'

/**
 * Properties map view (HOR-195) — Google Maps JS wrapper.
 *
 * Renders one AdvancedMarkerElement per property with a known
 * latitude/longitude. Properties without coords are silently
 * dropped from the map (still visible in the list view). After
 * G-NAF import (HOR-193), the vast majority of rows have coords
 * from PSMA's default geocode.
 *
 * Loader pattern matches components/address/address-autocomplete.tsx
 * — same @googlemaps/js-api-loader, same `version: 'weekly'`. Uses
 * the same NEXT_PUBLIC_GOOGLE_MAPS_API_KEY env var (key with Maps
 * JS API + Places API New enabled).
 *
 * Marker click navigates to /properties/[id] — same affordance the
 * list rows have. No side-panel preview in V1; the marker-first
 * UX shipped with HOR-195 covers the brief's "list + map view"
 * requirement without adding a third surface.
 *
 * Empty + degraded states:
 *   • zero properties → small "Nothing to plot" card
 *   • no Google Maps key → graceful "Map view unavailable" message
 *     (matches address-autocomplete.tsx's fallback pattern)
 *   • loader failure → same graceful message + console.error
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader } from '@googlemaps/js-api-loader'
import { MapPin } from 'lucide-react'
import type { EngagementValue } from '@/lib/design/badges'

export interface MapProperty {
  id:         string
  address:    string
  suburb:     string | null
  latitude:   number | null
  longitude:  number | null
  engagement: EngagementValue
}

interface Props {
  properties: MapProperty[]
  /**
   * Optional initial centre fallback when no properties have coords.
   * Typically the centroid of the agent's first core market.
   */
  fallbackCenter?: { lat: number; lng: number } | null
}

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
// Sydney CBD — last-resort centre when we have neither props nor a
// market centroid (e.g. an agent who hasn't imported anything yet but
// somehow landed on the map view).
const HORACE_HQ_FALLBACK = { lat: -33.8688, lng: 151.2093 }

// Engagement → marker tint. Same palette as the badge component for
// visual continuity between list and map views.
const TINT: Record<EngagementValue, string> = {
  0: '#8C7B6B', // stone
  1: '#C4622D80', // terracotta @ 50% — Low
  2: '#C4622DCC', // terracotta @ 80% — Medium
  3: '#C4622D',   // terracotta — High
}

export function PropertiesMap({ properties, fallbackCenter = null }: Props) {
  const router = useRouter()
  const hostRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([])
  const [degraded, setDegraded] = useState<string | null>(null)

  // Plottable subset — has coords. Memoised so the marker-sync effect
  // only re-runs when the actual coord set changes.
  const plottable = useMemo(
    () => properties.filter(
      (p): p is MapProperty & { latitude: number; longitude: number } =>
        typeof p.latitude === 'number' && typeof p.longitude === 'number',
    ),
    [properties],
  )

  // ── Mount: load Maps JS + create the map ──────────────────────────
  useEffect(() => {
    if (!API_KEY) {
      setDegraded('Map view requires a Google Maps key (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).')
      return
    }
    if (!hostRef.current) return

    let cancelled = false
    const loader = new Loader({ apiKey: API_KEY, version: 'weekly' })

    loader
      .importLibrary('maps')
      .then(async ({ Map: GMap }) => {
        if (cancelled || !hostRef.current) return

        // Initial centre: first plottable property if any, else the
        // fallback (market centroid), else Horace HQ.
        const initialCenter = plottable[0]
          ? { lat: plottable[0].latitude, lng: plottable[0].longitude }
          : (fallbackCenter ?? HORACE_HQ_FALLBACK)

        mapRef.current = new GMap(hostRef.current, {
          center: initialCenter,
          zoom: 13,
          mapId: 'horace-properties-map', // enables Advanced Markers
          disableDefaultUI: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        })
      })
      .catch((err) => {
        console.error('[properties-map] loader failed', err)
        setDegraded('Map view is unavailable right now.')
      })

    return () => {
      cancelled = true
      // Clean up markers — the Map instance is GC'd with the host DOM.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const m of markersRef.current) m.map = null
      markersRef.current = []
      mapRef.current = null
    }
    // Loader runs once per mount; fallbackCenter changes are handled by
    // the second effect via map.setCenter / fitBounds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Sync markers when `plottable` changes ─────────────────────────
  useEffect(() => {
    if (!mapRef.current || !API_KEY) return

    let cancelled = false

    const sync = async () => {
      try {
        const loader = new Loader({ apiKey: API_KEY, version: 'weekly' })
        const { AdvancedMarkerElement } = await loader.importLibrary('marker') as {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          AdvancedMarkerElement: any
        }
        if (cancelled) return

        // Clear previous markers.
        for (const m of markersRef.current) m.map = null
        markersRef.current = []

        // Add new markers.
        for (const p of plottable) {
          const dot = document.createElement('div')
          dot.style.cssText = `
            width: 14px; height: 14px; border-radius: 50%;
            background: ${TINT[p.engagement]};
            border: 2px solid #FAF7F2;
            box-shadow: 0 2px 6px rgba(0,0,0,0.18);
            cursor: pointer;
          `
          dot.title = p.address

          const marker = new AdvancedMarkerElement({
            map:      mapRef.current,
            position: { lat: p.latitude, lng: p.longitude },
            content:  dot,
            title:    p.address,
          })

          marker.addListener('click', () => {
            router.push(`/properties/${p.id}`)
          })

          markersRef.current.push(marker)
        }

        // Fit bounds to all markers when there's more than one. Single
        // marker keeps the zoom-13 default from the constructor.
        if (plottable.length > 1) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const bounds = new (window as any).google.maps.LatLngBounds()
          for (const p of plottable) bounds.extend({ lat: p.latitude, lng: p.longitude })
          mapRef.current.fitBounds(bounds, 64)
        } else if (plottable.length === 1) {
          mapRef.current.setCenter({ lat: plottable[0].latitude, lng: plottable[0].longitude })
          mapRef.current.setZoom(15)
        } else if (fallbackCenter) {
          mapRef.current.setCenter(fallbackCenter)
        }
      } catch (err) {
        console.error('[properties-map] marker sync failed', err)
      }
    }

    void sync()
    return () => { cancelled = true }
  }, [plottable, fallbackCenter, router])

  if (degraded) {
    return (
      <div
        style={{
          height: 480,
          background: '#FAF7F2',
          border: '1px solid rgba(140,123,107,0.22)',
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#8C7B6B',
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

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={hostRef}
        style={{
          height: 540,
          width: '100%',
          background: '#FAF7F2',
          border: '1px solid rgba(140,123,107,0.22)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      />
      {plottable.length === 0 && properties.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            padding: '8px 12px',
            background: 'rgba(26, 22, 18, 0.78)',
            color: '#FAF7F2',
            fontSize: 12,
            fontFamily: 'var(--font-body)',
            borderRadius: 6,
          }}
        >
          None of these properties have coordinates yet.
        </div>
      )}
    </div>
  )
}
