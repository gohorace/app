'use client'

import { useEffect } from 'react'

/**
 * HOR-160 — client-side bootstrap for an in-flight pairing.
 *
 * Writes the `pairing_active` cookie and `localStorage.pairingToken`
 * so the iOS dashboard standalone overlay (HOR-165) can detect a
 * pairing-in-progress when the PWA launches from the home-screen
 * icon (manifest start_url is /dashboard, not /m/[token]/install).
 *
 * Cookie attributes:
 *   • NOT HttpOnly — the dashboard overlay reads it client-side.
 *   • Secure (HTTPS only).
 *   • SameSite=Strict (no cross-site bleed).
 *   • Max-Age 1800s (30 min — comfortably covers the 15-min token
 *     TTL plus a buffer for the install/permission dance).
 *
 * Belt-and-braces: localStorage is the durable fallback for
 * pre-iOS-17 standalone PWAs whose cookie jar may be separate from
 * Safari's. localStorage is shared across both contexts.
 *
 * Server-side verification still happens on every read of the
 * token — never trust the cookie alone.
 */
export function PairingBootstrap({ token }: { token: string }) {
  useEffect(() => {
    try {
      const isSecure = window.location.protocol === 'https:'
      const attrs = [
        `pairing_active=${encodeURIComponent(token)}`,
        'Path=/',
        'Max-Age=1800',
        'SameSite=Strict',
        isSecure ? 'Secure' : '',
      ]
        .filter(Boolean)
        .join('; ')
      document.cookie = attrs
    } catch (err) {
      // Cookie writes can throw in private-mode browsers; non-fatal.
      console.warn('[pairing-bootstrap] cookie write failed', err)
    }

    try {
      window.localStorage.setItem('pairingToken', token)
    } catch (err) {
      // localStorage can throw in private-mode browsers / quota.
      console.warn('[pairing-bootstrap] localStorage write failed', err)
    }
  }, [token])

  return null
}
