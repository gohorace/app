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
  /** Optional id for input-label association in tests. */
  id?: string
}

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

/**
 * Reusable Google Places autocomplete + manual structured-field fallback.
 *
 * Behaviour:
 *   - Renders a single input bound to a Google Places Autocomplete widget.
 *   - On Place selection: parses components, lat/lng, place_id → calls onChange.
 *   - "Edit manually" link expands the structured fields below the input
 *     for manual entry / correction.
 *   - If the Google API fails to load OR `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
 *     is unset, structured fields are shown by default with a small note.
 *   - Manual edits of any structured field after a Google selection clear
 *     `google_place_id` / `latitude` / `longitude` on the next emit — the
 *     typed address has diverged from Google's notion of the place.
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
  const inputId = idProp ?? `addr-${autoId}`
  const inputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const [available, setAvailable] = useState<boolean>(Boolean(API_KEY))
  const [showManual, setShowManual] = useState<boolean>(!API_KEY)
  const [current, setCurrent] = useState<SelectedAddress | null>(defaultValue)

  // Seed input value from defaultValue on mount.
  useEffect(() => {
    if (inputRef.current && defaultValue?.formatted) {
      inputRef.current.value = defaultValue.formatted
    }
    // We intentionally only seed once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load Google Maps JS and wire up the Autocomplete widget.
  useEffect(() => {
    if (!API_KEY || !inputRef.current) return

    let cancelled = false
    const loader = new Loader({
      apiKey: API_KEY,
      libraries: ['places'],
      version: 'weekly',
    })

    loader
      .load()
      .then((google) => {
        if (cancelled || !inputRef.current) return

        const ac = new google.maps.places.Autocomplete(inputRef.current, {
          componentRestrictions: countryBias
            ? { country: countryBias.toLowerCase() }
            : undefined,
          fields: [
            'place_id',
            'address_components',
            'geometry.location',
            'formatted_address',
          ],
          types: ['address'],
        })

        ac.addListener('place_changed', () => {
          const place = ac.getPlace()
          if (!place || !place.address_components) {
            // Place lookup didn't return enough — surface manual fields.
            setShowManual(true)
            return
          }

          const components = place.address_components
          const pick = (type: string, short = false): string | null => {
            const c = components.find((x) => x.types.includes(type))
            return c ? (short ? c.short_name : c.long_name) : null
          }

          const next: SelectedAddress = {
            google_place_id: place.place_id ?? null,
            latitude: place.geometry?.location?.lat() ?? null,
            longitude: place.geometry?.location?.lng() ?? null,
            street_number: pick('street_number'),
            street_name: pick('route'),
            suburb: pick('locality') ?? pick('sublocality_level_1') ?? pick('postal_town'),
            state: pick('administrative_area_level_1', true),
            postcode: pick('postal_code'),
            formatted: place.formatted_address ?? null,
          }

          if (inputRef.current && next.formatted) {
            inputRef.current.value = next.formatted
          }

          setCurrent(next)
          setShowManual(false)
          onChangeRef.current(next)
        })

        autocompleteRef.current = ac
        setAvailable(true)
      })
      .catch(() => {
        if (cancelled) return
        // Network / quota / load failure → silently degrade to manual.
        setAvailable(false)
        setShowManual(true)
      })

    return () => {
      cancelled = true
    }
  }, [countryBias])

  // Manual-field edit: update structured field, clear Google fields.
  const updateField = useCallback(
    (key: keyof SelectedAddress, value: string) => {
      setCurrent((prev) => {
        const base = prev ?? emptyAddress()
        const next: SelectedAddress = {
          ...base,
          [key]: value.trim() === '' ? null : value,
          // Any manual edit invalidates the prior Google selection — the
          // typed address has diverged from the place we previously got.
          google_place_id: null,
          latitude: null,
          longitude: null,
        }
        next.formatted = formatAddressLine(next)
        // Reflect the freshly-composed line in the visible input.
        if (inputRef.current) inputRef.current.value = next.formatted
        // Emit (or emit null when everything has been cleared).
        onChangeRef.current(isAddressEmpty(next) ? null : next)
        return next
      })
    },
    [],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label htmlFor={inputId} style={labelStyle}>
        {label}
      </label>

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
          }}
        />
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          autoComplete="off"
          style={{ ...inputStyle, paddingLeft: 30 }}
        />
      </div>

      {/* Confirmation line + manual toggle */}
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

// --- Inline styles (matching the inline-style pattern used elsewhere
// in apps/web/src/components/contacts and /onboarding) ----------------------

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#5A4D40',
  fontFamily: 'var(--font-body)',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: '14px',
  fontFamily: 'var(--font-body)',
  color: '#1A1612',
  background: '#FAF7F2',
  border: '1px solid rgba(140,123,107,0.35)',
  borderRadius: '7px',
  outline: 'none',
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
