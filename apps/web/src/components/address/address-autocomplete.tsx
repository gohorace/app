'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Loader } from '@googlemaps/js-api-loader'
import { MapPin } from 'lucide-react'
import {
  type SelectedAddress,
  emptyAddress,
  formatAddressLine,
  isAddressEmpty,
} from './types'

interface Props {
  /** Label rendered above the input, e.g. "Home address". */
  label: string
  /** Optional initial value (for edit forms). */
  defaultValue?: SelectedAddress | null
  /** Fires on every change — Google selection AND manual edits. */
  onChange: (address: SelectedAddress | null) => void
  /** ISO-3166-1 alpha-2 (default: 'AU'). Use empty string for unbiased. */
  countryBias?: string
  /** Optional placeholder; defaults to "Start typing an address…". */
  placeholder?: string
  /** Optional id for testing. */
  id?: string
}

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

/**
 * Google's PlaceAutocompleteElement renders its own leading magnifying-glass
 * icon inside a CLOSED shadow DOM. It exposes no `::part()` for the icon and
 * no CSS variable to hide it, so the only way to reach it is to inject a style
 * into its shadow root — which requires the root to be open. We force ONLY
 * `gmp-*` elements' shadow roots open (every other web component keeps its
 * default), then hide the icon so a single map-pin remains (HOR-331).
 */
function ensureGmpShadowOpen() {
  if (typeof HTMLElement === 'undefined') return
  const proto = HTMLElement.prototype
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((proto.attachShadow as any).__horPatched) return
  const original = proto.attachShadow
  function patched(this: HTMLElement, init: ShadowRootInit) {
    if (this.tagName?.toLowerCase().startsWith('gmp-')) {
      return original.call(this, { ...init, mode: 'open' })
    }
    return original.call(this, init)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(patched as any).__horPatched = true
  proto.attachShadow = patched
}

/**
 * Inject a style into the element's (now-open) shadow root hiding Google's
 * built-in search icon. `visibility: hidden` (not `display: none`) preserves
 * the input's existing left padding so our overlaid <MapPin> stays aligned.
 * Retries across a few frames in case the shadow root attaches lazily.
 */
function hideGoogleSearchIcon(el: HTMLElement) {
  let attempts = 0
  const inject = () => {
    const root = el.shadowRoot
    if (root) {
      if (!root.querySelector('style[data-hor331]')) {
        const style = document.createElement('style')
        style.setAttribute('data-hor331', '')
        // `.autocomplete-icon` is Google's internal class for the leading
        // search icon. Internal/undocumented — if Google renames it the icon
        // reappears but nothing breaks.
        style.textContent = '.autocomplete-icon{visibility:hidden!important;}'
        root.appendChild(style)
      }
      return
    }
    if (attempts++ < 20) requestAnimationFrame(inject)
  }
  inject()
}

/**
 * Reusable Google Places autocomplete + manual structured-field fallback.
 *
 * Uses Google's new `PlaceAutocompleteElement` Web Component (Places API
 * (New)). The legacy `google.maps.places.Autocomplete` widget is blocked
 * for GCP projects created after 2025-03-01 — calls return
 * ApiNotActivatedMapError even when the legacy Places API is enabled — so
 * we cannot use it. The new element renders its own input; we mount it
 * inside our container div rather than binding to our own <input>.
 *
 * Behaviour matches the original:
 *   - Renders an autocomplete input (Google's element).
 *   - On selection → fetches Place fields and emits SelectedAddress via onChange.
 *   - "Edit manually" toggle expands structured fields for manual entry.
 *   - Manual edits after a Google selection clear google_place_id / lat / lng.
 *   - Graceful degradation when API key is missing OR load fails — manual
 *     fields shown by default with a small note.
 */
export function AddressAutocomplete({
  label,
  defaultValue = null,
  onChange,
  countryBias = 'AU',
  placeholder = 'Start typing an address…',
  id: idProp,
}: Props) {
  const autoId = useId()
  const elementHostId = idProp ?? `addr-${autoId}`
  const hostRef = useRef<HTMLDivElement>(null)
  const elementRef = useRef<HTMLElement | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const [available, setAvailable] = useState<boolean>(Boolean(API_KEY))
  const [showManual, setShowManual] = useState<boolean>(!API_KEY)
  const [current, setCurrent] = useState<SelectedAddress | null>(defaultValue)

  // Load the Places library + mount the PlaceAutocompleteElement.
  useEffect(() => {
    if (!API_KEY || !hostRef.current) return

    ensureGmpShadowOpen()

    let cancelled = false

    const loader = new Loader({
      apiKey: API_KEY,
      libraries: ['places'],
      version: 'weekly',
    })

    loader
      .load()
      .then(async (google) => {
        if (cancelled || !hostRef.current) return

        // The PlaceAutocompleteElement constructor lives on places.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const placesNs = (google.maps as any).places
        if (!placesNs?.PlaceAutocompleteElement) {
          // Library loaded but the new element constructor isn't present.
          // Most likely cause: Places API (New) isn't enabled on this key.
          setAvailable(false)
          setShowManual(true)
          return
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const el = new placesNs.PlaceAutocompleteElement({
          includedRegionCodes: countryBias ? [countryBias.toLowerCase()] : undefined,
        }) as HTMLElement

        el.id = elementHostId
        el.setAttribute('placeholder', placeholder)
        el.style.width = '100%'

        // Preserve a seeded value, if any, by setting the inner input's value
        // once the element's shadow DOM has wired up.
        if (defaultValue?.formatted) {
          queueMicrotask(() => {
            const input = el.querySelector('input') as HTMLInputElement | null
            if (input) input.value = defaultValue.formatted ?? ''
          })
        }

        // Selection event from the new element. The payload is a prediction
        // — convert to a Place and fetch the fields we need.
        el.addEventListener('gmp-select', async (rawEvent: Event) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const event = rawEvent as any
          const prediction = event.placePrediction
          if (!prediction) return

          try {
            const place = prediction.toPlace()
            await place.fetchFields({
              fields: ['id', 'formattedAddress', 'location', 'addressComponents'],
            })

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const components: Array<any> = place.addressComponents ?? []
            const pick = (type: string, short = false): string | null => {
              const c = components.find((x) => x.types.includes(type))
              return c ? (short ? (c.shortText ?? null) : (c.longText ?? null)) : null
            }

            const lat = typeof place.location?.lat === 'function'
              ? place.location.lat()
              : (place.location?.lat ?? null)
            const lng = typeof place.location?.lng === 'function'
              ? place.location.lng()
              : (place.location?.lng ?? null)

            const next: SelectedAddress = {
              google_place_id: place.id ?? null,
              latitude:        typeof lat === 'number' ? lat : null,
              longitude:       typeof lng === 'number' ? lng : null,
              street_number:   pick('street_number'),
              street_name:     pick('route'),
              suburb:          pick('locality') ?? pick('sublocality_level_1') ?? pick('postal_town'),
              state:           pick('administrative_area_level_1', true),
              postcode:        pick('postal_code'),
              formatted:       place.formattedAddress ?? null,
            }

            setCurrent(next)
            setShowManual(false)
            onChangeRef.current(next)
          } catch (err) {
            console.error('[AddressAutocomplete] Place fetch failed', err)
          }
        })

        hostRef.current.replaceChildren(el)
        elementRef.current = el
        hideGoogleSearchIcon(el)
        setAvailable(true)
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('[AddressAutocomplete] Google Places failed to load:', err)
        setAvailable(false)
        setShowManual(true)
      })

    return () => {
      cancelled = true
      elementRef.current?.remove()
      elementRef.current = null
    }
  }, [countryBias, elementHostId, placeholder, defaultValue?.formatted])

  // Manual-field edit: update structured field, clear Google fields.
  const updateField = useCallback(
    (key: keyof SelectedAddress, value: string) => {
      setCurrent((prev) => {
        const base = prev ?? emptyAddress()
        const next: SelectedAddress = {
          ...base,
          [key]: value.trim() === '' ? null : value,
          // Any manual edit invalidates the prior Google selection.
          google_place_id: null,
          latitude:        null,
          longitude:       null,
        }
        next.formatted = formatAddressLine(next)
        onChangeRef.current(isAddressEmpty(next) ? null : next)
        return next
      })
    },
    [],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label htmlFor={elementHostId} style={labelStyle}>
        {label}
      </label>

      {/* Host for the Google PlaceAutocompleteElement. The element manages
          its own internal input + dropdown; we just provide a placement. */}
      <div style={{ position: 'relative' }}>
        <MapPin
          aria-hidden
          style={{
            position: 'absolute',
            left: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 14,
            height: 14,
            opacity: 0.55,
            zIndex: 1,
            pointerEvents: 'none',
          }}
        />
        <div ref={hostRef} style={hostStyle} />
      </div>

      {current?.formatted && !showManual && (
        <div style={confirmStyle}>{current.formatted}</div>
      )}

      {!available && (
        <div style={noticeStyle}>
          Address autocomplete unavailable — enter the address manually below.
        </div>
      )}

      {!showManual && available && (
        <button
          type="button"
          onClick={() => setShowManual(true)}
          style={linkButtonStyle}
        >
          Edit manually
        </button>
      )}

      {showManual && (
        <div style={manualGridStyle}>
          <ManualField
            label="Street number"
            value={current?.street_number ?? ''}
            onChange={(v) => updateField('street_number', v)}
            width="100px"
            autoComplete="address-line1"
          />
          <ManualField
            label="Street name"
            value={current?.street_name ?? ''}
            onChange={(v) => updateField('street_name', v)}
            autoComplete="address-line2"
          />
          <ManualField
            label="Suburb"
            value={current?.suburb ?? ''}
            onChange={(v) => updateField('suburb', v)}
            autoComplete="address-level2"
          />
          <ManualField
            label="State"
            value={current?.state ?? ''}
            onChange={(v) => updateField('state', v)}
            width="80px"
            autoComplete="address-level1"
          />
          <ManualField
            label="Postcode"
            value={current?.postcode ?? ''}
            onChange={(v) => updateField('postcode', v)}
            width="100px"
            autoComplete="postal-code"
          />
        </div>
      )}
    </div>
  )
}

interface ManualFieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  width?: string
  autoComplete?: string
}

function ManualField({ label, value, onChange, width, autoComplete }: ManualFieldProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width }}>
      <label style={miniLabelStyle}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        style={miniInputStyle}
      />
    </div>
  )
}

// --- Inline styles ---------------------------------------------------------

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#5A4D40',
  fontFamily: 'var(--font-body)',
}

const hostStyle: React.CSSProperties = {
  width: '100%',
}

const confirmStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#5A4D40',
  fontFamily: 'var(--font-body)',
  opacity: 0.8,
}

const noticeStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#A5511E',
  fontFamily: 'var(--font-body)',
}

const linkButtonStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  background: 'transparent',
  border: 'none',
  padding: 0,
  color: '#A5511E',
  fontSize: '12px',
  fontFamily: 'var(--font-body)',
  textDecoration: 'underline',
  cursor: 'pointer',
}

const manualGridStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px',
  marginTop: '4px',
}

const miniLabelStyle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#5A4D40',
  fontFamily: 'var(--font-body)',
}

const miniInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  fontSize: '13px',
  fontFamily: 'var(--font-body)',
  color: '#1A1612',
  background: '#FAF7F2',
  border: '1px solid rgba(140,123,107,0.35)',
  borderRadius: '6px',
  outline: 'none',
}
