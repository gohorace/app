/**
 * HOR-149 — QR helpers for Doorstep inspections.
 *
 * Two functions, both built on the `qrcode` npm package:
 *
 *   - qrPngBuffer(url)   → Buffer  (suitable for image/png Response bodies)
 *   - qrDataUrl(url)     → string  ("data:image/png;base64,…" for inline render)
 *
 * Defaults chosen for the two usage paths:
 *
 *   - GET /api/inspections/<id>/qr  → A4 printable, ≥1024px, high error
 *                                     correction so creases survive
 *   - Detail page inline (HOR-150)  → smaller, embedded in the response
 *                                     payload as a data URL for an
 *                                     instant-render <img src>
 */

import QRCode from 'qrcode'

const PRINTABLE_SIZE = 1200 // px — clean at A4 when scaled to ~10cm wide
const INLINE_SIZE = 480 // px — sharp at 200-240px on retina screens

/**
 * Render a printable QR as a PNG buffer. Error-correction level H (~30%
 * loss tolerance) so a slightly creased or smudged print still scans.
 */
export async function qrPngBuffer(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: 'png',
    width: PRINTABLE_SIZE,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: {
      dark: '#3D332B',
      light: '#FFFFFF',
    },
  })
}

/**
 * Render a smaller QR as a base64 data URL, suitable for inlining into
 * JSON responses for instant render on the detail page (HOR-150).
 */
export async function qrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    type: 'image/png',
    width: INLINE_SIZE,
    margin: 1,
    errorCorrectionLevel: 'M', // lower correction; screen rendering is forgiving
    color: {
      dark: '#3D332B',
      light: '#FFFFFF',
    },
  })
}

/**
 * Compose a Content-Disposition-safe filename for a printable PNG. Falls
 * back to `open-home-<token>.png` if the address is empty.
 *
 *   slugifyForFilename({ street: '123 Smith Street', suburb: 'Surry Hills' },
 *                      new Date('2026-05-15'))
 *   → 'open-home-123-smith-street-surry-hills-2026-05-15.png'
 */
export function buildQrFilename(parts: {
  streetNumber: string | null
  streetName: string | null
  suburb: string | null
  scheduledAt: string
  token: string
}): string {
  const slug = [parts.streetNumber, parts.streetName, parts.suburb]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  const date = parts.scheduledAt.slice(0, 10) // YYYY-MM-DD
  const base = slug ? `open-home-${slug}-${date}` : `open-home-${parts.token}`
  return `${base}.png`
}
