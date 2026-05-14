'use client'

import { useState } from 'react'
import { ArrowRight, Bell, Check } from 'lucide-react'
import styles from './step-pair.module.css'
import onboardingStyles from './onboarding.module.css'

/**
 * HOR-161 — the success state on the desktop pair screen.
 *
 * Renders the paired pill with the device label substituted in, plus
 * a "Send a test push" affordance that fires /api/push/test (spec
 * acceptance criterion: test push lands on the paired device) and
 * a "Continue" CTA that lets the agent move on to the reveal step.
 */
interface Props {
  deviceLabel: string | null
  outcome: 'push_granted' | 'push_denied_but_installed' | null
  onContinue: () => void
}

type TestPhase = 'idle' | 'sending' | 'sent' | 'error'

export function PairedState({ deviceLabel, outcome, onContinue }: Props) {
  const [testPhase, setTestPhase] = useState<TestPhase>('idle')
  const [testMessage, setTestMessage] = useState<string | null>(null)

  const label = deviceLabel ?? 'phone'

  async function sendTest() {
    setTestPhase('sending')
    setTestMessage(null)
    try {
      const res = await fetch('/api/push/test', { method: 'POST' })
      if (res.ok) {
        setTestPhase('sent')
        setTestMessage(`Sent. Check your ${label}.`)
      } else {
        setTestPhase('error')
        setTestMessage("Couldn't send a test. Try again from Settings later.")
      }
    } catch {
      setTestPhase('error')
      setTestMessage("Couldn't send a test. Try again from Settings later.")
    }
  }

  return (
    <div className={styles.pairedWrap}>
      <div className={styles.pairedPill} role="status">
        <span className={styles.pairedDot} aria-hidden />
        <span>
          Paired. Push is live on your {label}.
        </span>
      </div>

      {outcome === 'push_denied_but_installed' && (
        <p className={styles.pairedNote}>
          You said no to alerts for now — Horace will stay quiet on this device.
          You can change your mind from Settings any time.
        </p>
      )}

      <div className={styles.pairedActions}>
        {outcome === 'push_granted' && (
          <button
            type="button"
            className={`${onboardingStyles.btn} ${onboardingStyles.btnGhost}`}
            onClick={sendTest}
            disabled={testPhase === 'sending'}
          >
            {testPhase === 'sent' ? <Check size={14} /> : <Bell size={14} />}
            {testPhase === 'sending'
              ? 'Sending…'
              : testPhase === 'sent'
                ? 'Test sent'
                : 'Send a test push'}
          </button>
        )}
        <button
          type="button"
          className={`${onboardingStyles.btn} ${onboardingStyles.btnPrimary}`}
          onClick={onContinue}
        >
          Continue <ArrowRight size={14} />
        </button>
      </div>

      {testMessage && (
        <p className={testPhase === 'error' ? styles.smsError : styles.smsHint}>
          {testMessage}
        </p>
      )}
    </div>
  )
}
