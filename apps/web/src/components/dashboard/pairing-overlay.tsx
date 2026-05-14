'use client'

import { useEffect, useState } from 'react'
import { PushPermissionPrompt } from '@/components/mobile/push-permission-prompt'

/**
 * HOR-165 — iOS PWA standalone fallback overlay.
 *
 * Why this exists: iOS Safari only allows push permission requests
 * from a standalone PWA context. The manifest start_url is /dashboard
 * (not /m/[token]/install), so when the user installs Horace mid-
 * pairing and taps the home-screen icon they land here on the
 * dashboard, NOT back at the install page. Without this overlay
 * they'd have no way to grant push.
 *
 * Detection chain:
 *   1. We're on the client.
 *   2. We're in standalone display mode (PWA, not Safari tab).
 *   3. There's a pairing_active cookie OR a localStorage.pairingToken.
 *      Both are set by /m/[token]/install/pairing-bootstrap.tsx
 *      (HOR-160). HttpOnly is intentionally false on the cookie so
 *      we can read it here.
 *   4. Server-side verification: GET /api/onboarding/pairing-status
 *      returns 'pending'. The cookie is never trusted alone.
 *
 * If all four pass, render <PushPermissionPrompt> as a modal-style
 * overlay covering the dashboard. On completion (either outcome),
 * clear the cookie + localStorage and dismiss.
 *
 * Defensive cleanup: 30-minute wall-clock cap. If the cookie is
 * still set after that window, clear it even if the server hasn't
 * been reached. The token's 15-min TTL plus a buffer.
 */

const COOKIE_NAME = 'pairing_active'
const LOCALSTORAGE_KEY = 'pairingToken'
const HARD_TIMEOUT_MS = 30 * 60 * 1000

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(
    new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'),
  )
  return m ? decodeURIComponent(m[1]) : null
}

function clearCookie(name: string) {
  if (typeof document === 'undefined') return
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Strict`
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  )
}

export function PairingOverlay() {
  const [token, setToken] = useState<string | null>(null)
  const [verified, setVerified] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!isStandalone()) return
    const fromCookie = readCookie(COOKIE_NAME)
    const fromStorage = (() => {
      try {
        return window.localStorage.getItem(LOCALSTORAGE_KEY)
      } catch {
        return null
      }
    })()
    const t = fromCookie || fromStorage
    if (!t) return
    setToken(t)
  }, [])

  // Server-side verify the token is still un-consumed for this
  // user's agent. Avoids rendering a stale overlay if the user
  // already completed pairing elsewhere.
  useEffect(() => {
    if (!token) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/onboarding/pairing-status')
        if (!res.ok) {
          // 401 = signed-out (overlay shouldn't render here anyway —
          // dashboard layout will redirect). 404 = no token for this
          // agent. Either way: clear and bail.
          if (!cancelled) clearAndDismiss()
          return
        }
        const data = (await res.json()) as { status: 'pending' | 'paired' }
        if (data.status === 'pending' && !cancelled) {
          setVerified(true)
        } else if (!cancelled) {
          clearAndDismiss()
        }
      } catch {
        // Network blip — leave the overlay dormant; we'll retry on
        // next mount. No clobbering.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  // Defensive 30-min cap.
  useEffect(() => {
    if (!verified) return
    const timer = setTimeout(clearAndDismiss, HARD_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [verified])

  function clearAndDismiss() {
    clearCookie(COOKIE_NAME)
    try {
      window.localStorage.removeItem(LOCALSTORAGE_KEY)
    } catch {
      // ignore
    }
    setDismissed(true)
  }

  if (dismissed || !token || !verified) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Finish pairing your phone"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26, 22, 18, 0.55)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'var(--color-parchment, #F5F0E8)',
          borderRadius: 16,
          padding: 24,
          boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: 'var(--color-terracotta, #C4622D)',
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>
            Horace
          </span>
        </div>
        <h2
          style={{
            fontFamily: 'var(--font-serif, Georgia, serif)',
            fontSize: 22,
            lineHeight: 1.2,
            margin: '0 0 8px',
          }}
        >
          One last step.
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--color-stone, #6B6B6B)', margin: '0 0 18px' }}>
          You&rsquo;ve added Horace to your home screen — now let us send the
          push that taps you on the shoulder when a signal lands.
        </p>
        <PushPermissionPrompt token={token} onCompleted={clearAndDismiss} />
      </div>
    </div>
  )
}
