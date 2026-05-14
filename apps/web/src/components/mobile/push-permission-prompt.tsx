'use client'

import { useState } from 'react'
import { Bell, Check } from 'lucide-react'
import {
  requestPushPermission,
  savePushSubscription,
  type DeviceKind,
} from '@/components/push-manager'
import {
  deviceLabelFromUA,
  deviceKindFromUA,
} from '@/lib/pairing/device-label'
import styles from './install.module.css'

/**
 * HOR-164 — shared push permission prompt.
 *
 * Used by both the Android install flow (rendered inline once the
 * install prompt resolves) and the dashboard standalone overlay
 * (HOR-165, rendered when an iOS PWA launches from the home-screen
 * icon mid-pairing).
 *
 * Flow:
 *   1. Click "Allow notifications".
 *   2. requestPushPermission() asks the browser. Three outcomes:
 *      • Subscription returned    → save it (with deviceKind),
 *                                    POST pairing-complete with
 *                                    outcome push_granted.
 *      • Returned null            → user denied or unsupported.
 *                                    POST pairing-complete with
 *                                    outcome push_denied_but_installed.
 *      • Threw (no SW / no Push)  → render the unsupported copy
 *                                    (no completion event fires —
 *                                    we can't reliably mark this
 *                                    paired in any sense).
 *
 * Calling pairing-complete on the denial path is what gives the
 * desktop "Paired" pill its right-to-flip even when the user said
 * no to push. The spec is explicit about that behaviour.
 */

interface Props {
  token: string
  /**
   * Optional callback fired after either outcome completes
   * (success or denial). The dashboard overlay uses this to clean
   * up its cookie + localStorage and dismiss itself.
   */
  onCompleted?: () => void
}

type Phase = 'idle' | 'asking' | 'granted' | 'denied' | 'unsupported' | 'error'

export function PushPermissionPrompt({ token, onCompleted }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')

  async function postPairingComplete(
    outcome: 'push_granted' | 'push_denied_but_installed',
  ) {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    const deviceLabel = deviceLabelFromUA(ua)
    await fetch('/api/onboarding/pairing-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, outcome, deviceLabel }),
    })
  }

  async function ask() {
    if (phase === 'asking') return
    setPhase('asking')

    // Defensive: feature-detect before asking. If the browser has
    // no service worker or no Push API, we treat it as unsupported
    // and bail out without firing any completion event.
    if (
      typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator) ||
      typeof window === 'undefined' ||
      !('PushManager' in window)
    ) {
      setPhase('unsupported')
      return
    }

    try {
      const sub = await requestPushPermission()
      if (sub) {
        const kind: DeviceKind = deviceKindFromUA(navigator.userAgent)
        await savePushSubscription(sub, { deviceKind: kind })
        await postPairingComplete('push_granted')
        setPhase('granted')
        onCompleted?.()
      } else {
        // Permission denied (or default — Safari treats dismissal
        // as default). The phone is still installed/signed in, so
        // we report the denial outcome and let the desktop flip to
        // Paired with the muted note.
        await postPairingComplete('push_denied_but_installed')
        setPhase('denied')
        onCompleted?.()
      }
    } catch (err) {
      console.error('[PushPermissionPrompt] requestPushPermission threw', err)
      setPhase('error')
    }
  }

  if (phase === 'granted') {
    return (
      <div className={styles.standaloneBanner} role="status">
        <strong>You&rsquo;re paired.</strong> Head back to your desktop —
        Horace will take it from here.
      </div>
    )
  }

  if (phase === 'denied') {
    return (
      <div className={styles.standaloneBanner} role="status">
        No worries. You can turn this on later in settings.
      </div>
    )
  }

  if (phase === 'unsupported') {
    return (
      <div className={styles.standaloneBanner} role="status">
        Push isn&rsquo;t supported in this browser. Open this link in
        Safari or Chrome to continue.
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className={styles.standaloneBanner} role="alert">
        Something went wrong asking for permission. You can try again
        from your phone settings — or come back to the desktop.
      </div>
    )
  }

  return (
    <div className={styles.installAction}>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
        Let Horace tap you on the shoulder when something&rsquo;s worth
        your attention.
      </p>
      <button
        type="button"
        onClick={ask}
        disabled={phase === 'asking'}
        className={styles.installButton}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 18px',
          background: 'var(--color-terracotta, #C4622D)',
          color: '#FFFFFF',
          border: 'none',
          borderRadius: 999,
          fontSize: 15,
          fontWeight: 500,
          cursor: phase === 'asking' ? 'wait' : 'pointer',
        }}
      >
        {phase === 'asking' ? <Check size={16} /> : <Bell size={16} />}
        {phase === 'asking' ? 'Asking your browser…' : 'Allow notifications'}
      </button>
    </div>
  )
}
