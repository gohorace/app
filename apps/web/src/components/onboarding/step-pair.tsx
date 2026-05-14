'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import styles from './onboarding.module.css'
import pairStyles from './step-pair.module.css'
import { QRCard } from './qr-card'
import { SMSForm } from './sms-form'
import { PairedState } from './paired-state'

/**
 * HOR-161 — the desktop pair screen.
 *
 * Mounts inside OnboardingWizard (a client component, so this is
 * also a client component). On mount it fetches a fresh pairing
 * token via /api/onboarding/pairing-token, then polls
 * /api/onboarding/pairing-status every 2s until paired. On paired,
 * swaps to <PairedState>. The "Continue" CTA on PairedState calls
 * onNext — the wizard marks 'pair' complete and moves to the reveal.
 *
 * Polling is paused while the tab is hidden (visibilitychange) and
 * resumes on focus. It also stops at the token's wall-clock expiry,
 * with a clear message and a re-issue button.
 */
interface Props {
  stepNumber: number
  totalSteps: number
  onNext: () => void
  onBack: () => void
}

type FetchState =
  | { phase: 'loading' }
  | { phase: 'ready'; token: string; qrUrl: string; qrDataUrl: string; expiresAt: number }
  | { phase: 'error'; message: string }

type PairState =
  | { phase: 'pending' }
  | {
      phase: 'paired'
      deviceLabel: string | null
      outcome: 'push_granted' | 'push_denied_but_installed' | null
    }
  | { phase: 'expired' }

const POLL_INTERVAL_MS = 2000

export function StepPair({ stepNumber, totalSteps, onNext, onBack }: Props) {
  const [fetchState, setFetchState] = useState<FetchState>({ phase: 'loading' })
  const [pairState, setPairState] = useState<PairState>({ phase: 'pending' })

  // Issue a token on mount (and on explicit re-issue via the
  // expired-state button below).
  const [issueNonce, setIssueNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setFetchState({ phase: 'loading' })
    setPairState({ phase: 'pending' })

    ;(async () => {
      try {
        const res = await fetch('/api/onboarding/pairing-token', { method: 'POST' })
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          if (!cancelled) {
            setFetchState({
              phase: 'error',
              message: data.error ?? "Couldn't start pairing. Try again in a moment.",
            })
          }
          return
        }
        const data = (await res.json()) as {
          token: string
          qrUrl: string
          qrDataUrl: string
          expiresAt: string
        }
        if (cancelled) return
        setFetchState({
          phase: 'ready',
          token: data.token,
          qrUrl: data.qrUrl,
          qrDataUrl: data.qrDataUrl,
          expiresAt: new Date(data.expiresAt).getTime(),
        })
      } catch {
        if (!cancelled) {
          setFetchState({
            phase: 'error',
            message: "Couldn't start pairing. Try again in a moment.",
          })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [issueNonce])

  // Poll status while ready + pending + tab visible + before expiry.
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (fetchState.phase !== 'ready') return
    if (pairState.phase !== 'pending') return

    const expiresAt = fetchState.expiresAt

    async function tick() {
      if (Date.now() >= expiresAt) {
        setPairState({ phase: 'expired' })
        return
      }
      try {
        const res = await fetch('/api/onboarding/pairing-status')
        if (!res.ok) return // transient; keep polling
        const data = (await res.json()) as
          | { status: 'pending' }
          | {
              status: 'paired'
              outcome: 'push_granted' | 'push_denied_but_installed' | null
              deviceLabel: string | null
            }
        if (data.status === 'paired') {
          setPairState({
            phase: 'paired',
            deviceLabel: data.deviceLabel,
            outcome: data.outcome,
          })
        }
      } catch {
        // network blip; keep polling
      }
    }

    function start() {
      if (pollTimer.current) return
      // Fire once immediately, then on interval.
      void tick()
      pollTimer.current = setInterval(tick, POLL_INTERVAL_MS)
    }
    function stop() {
      if (pollTimer.current) {
        clearInterval(pollTimer.current)
        pollTimer.current = null
      }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [fetchState, pairState.phase])

  return (
    <div className={styles.stepFade}>
      <div className={styles.paneMeta}>
        <span>Mobile push</span>
        <span className={styles.paneMetaDivider} />
        <span>Step {stepNumber} of {totalSteps}</span>
      </div>
      <h1 className={styles.paneTitle}>Take Horace with you.</h1>
      <p className={styles.paneSub}>
        Most signals land while you&rsquo;re between meetings — at the listing, in the car, before coffee.
        Add Horace to your home screen for one-tap access and push alerts.
      </p>

      {pairState.phase === 'paired' ? (
        <PairedState
          deviceLabel={pairState.deviceLabel}
          outcome={pairState.outcome}
          onContinue={onNext}
        />
      ) : pairState.phase === 'expired' ? (
        <ExpiredCard onReissue={() => setIssueNonce((n) => n + 1)} />
      ) : fetchState.phase === 'loading' ? (
        <div className={pairStyles.loadingCard}>Generating your pairing code…</div>
      ) : fetchState.phase === 'error' ? (
        <ErrorCard message={fetchState.message} onRetry={() => setIssueNonce((n) => n + 1)} />
      ) : (
        <div className={pairStyles.pairBody}>
          <QRCard qrDataUrl={fetchState.qrDataUrl} qrUrl={fetchState.qrUrl} />
          <SMSForm token={fetchState.token} />
        </div>
      )}

      <blockquote className={pairStyles.horaceQuote}>
        <span className={pairStyles.horaceQuoteDash} aria-hidden />
        &ldquo;You&rsquo;ll catch most signals on the move. The phone in your pocket is where this earns its keep.&rdquo;
      </blockquote>

      <div className={styles.paneActions}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGhost}`}
          onClick={onBack}
        >
          <ArrowLeft size={14} /> Back
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGhost}`}
          onClick={onNext}
        >
          {pairState.phase === 'paired' ? 'Continue' : "I'll do this later"}
        </button>
      </div>
    </div>
  )
}

function ExpiredCard({ onReissue }: { onReissue: () => void }) {
  return (
    <div className={pairStyles.expiredCard}>
      <p>This pairing code expired. Get a fresh one.</p>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnSecondary}`}
        onClick={onReissue}
      >
        Generate a new code
      </button>
    </div>
  )
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={pairStyles.expiredCard}>
      <p>{message}</p>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnSecondary}`}
        onClick={onRetry}
      >
        Try again
      </button>
    </div>
  )
}
