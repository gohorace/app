'use client'

import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { PushPermissionPrompt } from './push-permission-prompt'
import styles from './install.module.css'

/**
 * HOR-164 — Android Chrome install prompt.
 *
 * Captures the `beforeinstallprompt` event on mount and re-fires
 * it on user gesture (Chrome requires the prompt to come from a
 * direct user interaction). After the install completes (or the
 * user dismisses) we hand off to <PushPermissionPrompt>.
 *
 * Push permission can be requested in browser context on Android
 * (no standalone requirement), so the install and push prompts can
 * live side by side on the same page.
 */

interface Props {
  token: string
}

// Minimal type for the event — Chrome's BeforeInstallPromptEvent
// isn't in the standard lib.d.ts at all browsers, so we declare
// just what we need.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type Phase = 'await-event' | 'ready' | 'prompting' | 'installed' | 'dismissed'

export function AndroidInstallPrompt({ token }: Props) {
  const [phase, setPhase] = useState<Phase>('await-event')
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    // If the page reloaded after the user already installed (or the
    // browser blocked the prompt for some reason), beforeinstallprompt
    // won't fire. The push prompt is the more important affordance —
    // we shouldn't hide it forever waiting for an event that may
    // never arrive. Auto-advance after a short grace period so the
    // user still gets to push.
    const gracePeriodMs = 3500
    const timer = setTimeout(() => {
      setPhase((p) => (p === 'await-event' ? 'dismissed' : p))
    }, gracePeriodMs)

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setPhase('ready')
      clearTimeout(timer)
    }

    function onAppInstalled() {
      setPhase('installed')
      clearTimeout(timer)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
      clearTimeout(timer)
    }
  }, [])

  async function install() {
    if (!deferredPrompt) return
    setPhase('prompting')
    try {
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      setPhase(choice.outcome === 'accepted' ? 'installed' : 'dismissed')
    } catch {
      // If Chrome refuses for any reason, move on — push is the
      // important step anyway.
      setPhase('dismissed')
    } finally {
      setDeferredPrompt(null)
    }
  }

  return (
    <div className={styles.guide}>
      {(phase === 'await-event' || phase === 'ready' || phase === 'prompting') && (
        <div className={styles.step}>
          <span className={styles.stepBullet} aria-hidden>
            <Download size={16} />
          </span>
          <div className={styles.stepBody}>
            <div className={styles.stepTitle}>Install Horace</div>
            <div className={styles.stepCopy}>
              {phase === 'await-event'
                ? 'Tap install when Chrome offers it (we’ll keep going either way).'
                : phase === 'prompting'
                  ? 'Choose Install in the dialog.'
                  : 'Tap install to add Horace to your home screen.'}
            </div>
            {phase === 'ready' && (
              <div className={styles.installAction}>
                <button
                  type="button"
                  onClick={install}
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
                    cursor: 'pointer',
                  }}
                >
                  <Download size={16} /> Install Horace
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Push prompt renders alongside the install affordance once
        * either path resolves. We don't gate push behind install —
        * push is the must-have signal channel for the spec. */}
      {(phase === 'installed' || phase === 'dismissed') && (
        <PushPermissionPrompt token={token} />
      )}
    </div>
  )
}
