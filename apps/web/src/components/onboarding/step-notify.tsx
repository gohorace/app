'use client'

import Image from 'next/image'
import { useState } from 'react'
import { Bell, ArrowRight, ArrowLeft, Check } from 'lucide-react'
import { requestPushPermission, savePushSubscription } from '@/components/push-manager'
import styles from './onboarding.module.css'
import notifyStyles from './step-notify.module.css'

interface Props {
  stepNumber: number
  totalSteps: number
  onNext: () => void
  onBack: () => void
}

type PermState = 'idle' | 'granted' | 'blocked' | 'unsupported'

export function StepNotify({ stepNumber, totalSteps, onNext, onBack }: Props) {
  const [permState, setPermState] = useState<PermState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function enable() {
    setBusy(true); setError(null)
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPermState('unsupported')
      setBusy(false)
      return
    }
    try {
      const sub = await requestPushPermission()
      if (!sub) {
        setPermState('blocked')
      } else {
        await savePushSubscription(sub)
        setPermState('granted')
      }
    } catch {
      setError('Something went wrong. You can enable alerts later in Settings.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.stepFade}>
      <div className={styles.paneMeta}>
        <span>Browser alerts</span>
        <span className={styles.paneMetaDivider} />
        <span>Step {stepNumber} of {totalSteps}</span>
      </div>
      <h1 className={styles.paneTitle}>A whisper, never a shout.</h1>
      <p className={styles.paneSub}>
        Get a desktop alert only when a signal is genuinely worth your attention. Two or three a week, max — Horace stays quiet otherwise.
      </p>

      <div className={notifyStyles.preview}>
        <div className={notifyStyles.notifChrome}>
          <Image
            src="/horace-notif-icon.png"
            alt=""
            width={36}
            height={36}
            className={notifyStyles.notifIcon}
          />
          <div className={notifyStyles.notifText}>
            <div className={notifyStyles.notifTitle}>Horace</div>
            <div className={notifyStyles.notifBody}>
              &ldquo;Sarah Thompson is back. Appraisal page, twice this week.&rdquo;
            </div>
          </div>
          <div className={notifyStyles.notifMeta}>now</div>
        </div>
        <div className={notifyStyles.previewLabel}>What an alert looks like</div>
      </div>

      <div className={notifyStyles.stateRow}>
        {permState === 'idle' && (
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={enable} disabled={busy} type="button">
            <Bell size={14} /> {busy ? 'Asking your browser…' : 'Allow browser alerts'}
          </button>
        )}
        {permState === 'granted' && (
          <div className={notifyStyles.granted}>
            <span className={notifyStyles.checkIcon}><Check size={14} /></span>
            Alerts enabled — Horace will only ping you when it counts.
          </div>
        )}
        {permState === 'blocked' && (
          <div className={notifyStyles.blockedNote}>
            Alerts blocked in your browser. You can re-enable them from Settings whenever you’re ready.
          </div>
        )}
        {permState === 'unsupported' && (
          <div className={notifyStyles.blockedNote}>
            This browser doesn’t support push alerts — we’ll catch you on email and mobile.
          </div>
        )}
        {error && <p className={notifyStyles.error}>{error}</p>}
      </div>

      <div className={styles.paneActions}>
        <button className={`${styles.btn} ${styles.btnGhost}`} onClick={onBack} type="button">
          <ArrowLeft size={14} /> Back
        </button>
        <div className={styles.paneActionsRight}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={onNext} type="button">
            Continue <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
