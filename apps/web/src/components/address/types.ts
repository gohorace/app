/**
 * Shape emitted by `<AddressAutocomplete>`.
 *
 * Every field is independently nullable to support partial inputs:
 *
 *   - Google Places autocomplete selection populates `google_place_id`,
 *     `latitude`, `longitude`, the structured components, and `formatted`.
 *   - Manual / fallback structured-field entry populates just the
 *     structured components (and `formatted` is computed).
 *   - Editing a previously-autocompleted address manually nulls
 *     `google_place_id`, `latitude`, `longitude` — the address has
 *     diverged from Google's notion of the place.
 *
 * Consumers (contact form, manual property creation) pass the whole
 * object as a `residence` body field to their backend route, which
 * forwards it to `resolve_residence_property` via Supabase RPC.
 */
export type SelectedAddress = {
  google_place_id: string | null
  latitude: number | null
  longitude: number | null
  street_number: string | null
  street_name: string | null
  suburb: string | null
  state: string | null
  postcode: string | null
  /** Human-readable single line. Built from Google or composed from parts. */
  formatted: string | null
}

export function emptyAddress(): SelectedAddress {
  return {
    google_place_id: null,
    latitude: null,
    longitude: null,
    street_number: null,
    street_name: null,
    suburb: null,
    state: null,
    postcode: null,
    formatted: null,
  }
}

export function isAddressEmpty(a: SelectedAddress | null): boolean {
  if (!a) return true
  return (
    !a.google_place_id &&
    !a.street_number &&
    !a.street_name &&
    !a.suburb &&
    !a.state &&
    !a.postcode
  )
}

/** Compose the human-readable formatted line from structured parts. */
export function formatAddressLine(a: SelectedAddress): string {
  const street = [a.street_number, a.street_name].filter(Boolean).join(' ')
  const local = [a.suburb, a.state, a.postcode].filter(Boolean).join(' ')
  return [street, local].filter(Boolean).join(', ')
}
