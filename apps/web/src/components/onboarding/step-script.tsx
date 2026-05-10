'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Check, Mail, Link2, Calendar, ArrowRight } from 'lucide-react'
import { CopyButton } from '@/components/ui/copy-button'
import { HelpModal, type HelpKind } from './help-modal'
import styles from './onboarding.module.css'
import scriptStyles from './step-script.module.css'

interface Props {
  snippetKey: string
  appUrl: string
  firstName: string | null
  stepNumber: number
  totalSteps: number
  onNext: () => void
}

type VerifyState = 'idle' | 'detecting' | 'detected'

export function StepScript({
  snippetKey,
  appUrl,
  firstName,
  stepNumber,
  totalSteps,
  onNext,
}: Props) {
  const [website, setWebsite] = useState('')
  const [verifyState, setVerifyState] = useState<VerifyState>('idle')
  const [helpOpen, setHelpOpen] = useState<HelpKind | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stopAtRef = useRef<number>(0)

  const snippet = `<!-- Horace -->
<script>
  window.RIQ = {
    key: '${snippetKey}',
    apiUrl: '${appUrl}/api',
    propertyPattern: '/property/'
  };
</script>
<script src="${appUrl}/tracker.min.js" defer></script>`

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    setVerifyState('detecting')
    stopAtRef.current = Date.now() + 5 * 60 * 1000 // poll for up to 5 minutes
    pollRef.current = setInterval(async () => {
      if (Date.now() > stopAtRef.current) {
        if (pollRef.current) clearInterval(pollRef.current)
        return
      }
      try {
        const res = await fetch('/api/onboarding/verify-snippet', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (data.verified) {
          setVerifyState('detected')
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch {
        // network blip — keep polling
      }
    }, 3000)
  }, [])

  // Auto-start polling on mount in case the snippet was pasted before this step
  useEffect(() => {
    startPolling()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [startPolling])

  const handleWebsiteBlur = () => {
    if (website.trim() && verifyState === 'idle') {
      startPolling()
    }
  }

  const verifyPill =
    verifyState === 'detected' ? (
      <span className={`${scriptStyles.pill} ${scriptStyles.pillDetected}`}>
        <Check size={13} /> Tracking confirmed
      </span>
    ) : verifyState === 'detecting' ? (
      <span className={`${scriptStyles.pill} ${scriptStyles.pillDetecting}`}>
        <span className={scriptStyles.pulseDot} aria-hidden /> Listening for your first visitor…
      </span>
    ) : (
      <span className={`${scriptStyles.pill} ${scriptStyles.pillIdle}`}>
        Not detected yet
      </span>
    )

  return (
    <div className={styles.stepFade}>
      <div className={styles.paneMeta}>
        <span>Tracking script</span>
        <span className={styles.paneMetaDivider} />
        <span>Step {stepNumber} of {totalSteps}</span>
      </div>
      <h1 className={styles.paneTitle}>
        {firstName ? `${firstName}, let’s get Horace listening.` : 'Let’s get Horace listening.'}
      </h1>
      <p className={styles.paneSub}>
        Drop one snippet on your website. The moment a visitor lands, Horace starts watching for the patterns that matter — sold pages revisited, suburb reports downloaded, return trips between meetings.
      </p>

      <div className={scriptStyles.field}>
        <label className={scriptStyles.fieldLabel} htmlFor="onb-website">Your website</label>
        <input
          id="onb-website"
          className={scriptStyles.fieldInput}
          placeholder="reidproperty.com.au"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          onBlur={handleWebsiteBlur}
          autoComplete="url"
        />
      </div>

      <div className={scriptStyles.snippetBlock}>
        <div className={scriptStyles.snippetHeader}>
          <span className={scriptStyles.snippetLabel}>Paste before <code>&lt;/head&gt;</code></span>
          <CopyButton text={snippet} />
        </div>
        <pre className={scriptStyles.snippetCode}>
          <code>{snippet}</code>
        </pre>
        <div className={scriptStyles.verifyRow}>
          {verifyPill}
        </div>
      </div>

      <div className={scriptStyles.helpRow}>
        <span className={scriptStyles.helpLabel}>Not the one who installs scripts?</span>
        <div className={scriptStyles.helpButtons}>
          <button className={scriptStyles.helpBtn} onClick={() => setHelpOpen('email')} type="button">
            <Mail size={14} /> Send to your web person
          </button>
          <button className={scriptStyles.helpBtn} onClick={() => setHelpOpen('share')} type="button">
            <Link2 size={14} /> Share install link
          </button>
          <button className={scriptStyles.helpBtn} onClick={() => setHelpOpen('book')} type="button">
            <Calendar size={14} /> Book a 15-min call
          </button>
        </div>
      </div>

      <div className={styles.paneActions}>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--color-stone-aa)' }}>
          {verifyState === 'detected'
            ? 'Tracking confirmed — ready when you are.'
            : 'Tip: keep this tab open while you paste. Horace will catch the first ping.'}
        </span>
        <div className={styles.paneActionsRight}>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={onNext}
            type="button"
          >
            Continue <ArrowRight size={14} />
          </button>
        </div>
      </div>

      <HelpModal
        kind={helpOpen}
        snippet={snippet}
        snippetKey={snippetKey}
        appUrl={appUrl}
        onClose={() => setHelpOpen(null)}
      />
    </div>
  )
}
