/**
 * HOR-56 device-label parser.
 *
 * Maps a User-Agent string to a short, human-readable label used in
 * the desktop "Paired" pill ("Paired. Push is live on your iPhone.")
 * and on the `push_subscriptions.device_kind` column for future
 * device-targeted pushes.
 *
 * Pure function — no env, no headers, no globals. Deterministic and
 * trivially unit-testable. Falls back to a generic "phone" / "other"
 * label rather than guessing, so we never claim more than we know.
 */

export type DeviceLabel =
  | 'iPhone'
  | 'iPad'
  | 'Android phone'
  | 'Android tablet'
  | 'phone'

export type DeviceKind = 'desktop' | 'mobile' | 'tablet' | 'other'

/**
 * Best-guess human-readable label. Used in the paired-state UI copy.
 * Conservative — unknown devices return "phone" (the spec's fallback),
 * not "device" or "browser".
 */
export function deviceLabelFromUA(ua: string | null | undefined): DeviceLabel {
  if (!ua) return 'phone'
  const s = ua.toLowerCase()

  // iPadOS 13+ identifies as Mac in some User-Agent surfaces; we
  // don't try to disambiguate that here. The plain "iPad" UA still
  // works for most devices via Safari.
  if (s.includes('ipad')) return 'iPad'
  if (s.includes('iphone')) return 'iPhone'

  if (s.includes('android')) {
    // "Mobile" inside an Android UA string conventionally indicates
    // a phone; without it, the device is typically a tablet.
    if (s.includes('mobile')) return 'Android phone'
    return 'Android tablet'
  }

  return 'phone'
}

/**
 * Coarser bucket suitable for the `push_subscriptions.device_kind`
 * column. Used to filter test pushes ("send to the paired phone only")
 * without committing to a brand label.
 */
export function deviceKindFromUA(ua: string | null | undefined): DeviceKind {
  if (!ua) return 'other'
  const s = ua.toLowerCase()

  if (s.includes('ipad')) return 'tablet'
  if (s.includes('iphone')) return 'mobile'
  if (s.includes('android')) {
    if (s.includes('mobile')) return 'mobile'
    return 'tablet'
  }

  // Everything else (macOS, Windows, Linux desktop browsers, the
  // long tail of crawlers/in-app webviews) lands here. Caller can
  // choose to treat 'other' as desktop in display contexts.
  return 'other'
}
