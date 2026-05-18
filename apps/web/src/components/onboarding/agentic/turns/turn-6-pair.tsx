'use client'

import { useEffect, useRef, useState } from 'react'
import { QRCard } from '../../qr-card'
import { SMSForm } from '../../sms-form'
import pairStyles from '../../step-pair.module.css'
import wizardStyles from '../../onboarding.module.css'
import styles from '../agentic-shell.module.css'
import { horace } from '../copy'
import { markStepComplete } from '../mark-step'
import { type Action } from '../turn-controller'

interface Props {
  dispatch: React.Dispatch<Action>
  onAdvance: () => void
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

// HOR-56: SMS fallback is gated behind an env flag while waiting on
// Twilio AU compliance. Mirror of v1 step-pair.tsx behaviour.
const SMS_ENABLED = process.env.NEXT_PUBLIC_PAIRING_SMS_ENABLED === 'true'

/** Turn 6 — mobile push.
 *
 *  Mirrors v1 step-pair.tsx beat for beat: issue a pairing token on
 *  mount, poll /api/onboarding/pairing-status every 2s (with
 *  visibility-pause + wall-clock expiry handling), swap to a paired
 *  state once the phone hits the QR link.
 *
 *  Skip allowed. The brief frames pair as a "want me on your phone
 *  too?" — not a gate. Agents who skip can pair later from Settings. */
export function Turn6Pair({ dispatch, onAdvance }: Props) {
  const didMount = useRef(false)
  const onAdvanceRef = useRef(onAdvance)
  onAdvanceRef.current = onAdvance

  const [fetchState, setFetchState] = useState<FetchState>({ phase: 'loading' })
  const [pairState, setPairState] = useState<PairState>({ phase: 'pending' })
  const [issueNonce, setIssueNonce] = useState(0)
  const [done, setDone] = useState(false)

  // Opening Horace line on mount.
  useEffect(() => {
    if (didMount.current) return
    didMount.current = true
    dispatch({ type: 'horace_says', text: horace.t6_ask_pair() })
  }, [dispatch])

  // Issue a pairing token on mount + on explicit re-issue.
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
  // Verbatim from v1 step-pair.tsx so behaviour matches.
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
        if (!res.ok) return
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
        // transient; keep polling
      }
    }

    function start() {
      if (pollTimer.current) return
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

  // When pairing succeeds, dispatch the success line + advance.
  const pairAckFired = useRef(false)
  useEffect(() => {
    if (pairState.phase !== 'paired' || pairAckFired.current) return
    pairAckFired.current = true
    dispatch({ type: 'user_says', text: 'Paired from my phone' })
    dispatch({ type: 'horace_says', text: horace.t6_paired() })
    ;(async () => {
      await markStepComplete('pair')
      setDone(true)
      setTimeout(() => onAdvanceRef.current(), 1500)
    })()
  }, [dispatch, pairState.phase])

  async function skip() {
    dispatch({ type: 'user_says', text: 'Skip for now' })
    dispatch({ type: 'horace_says', text: horace.t6_pair_skip() })
    await markStepComplete('pair')
    setDone(true)
    setTimeout(() => onAdvanceRef.current(), 800)
  }

  if (done) return null

  return (
    <div className={styles.patchInputWrap}>
      {fetchState.phase === 'loading' ? (
        <div className={pairStyles.loadingCard}>Generating your pairing code…</div>
      ) : fetchState.phase === 'error' ? (
        <div className={pairStyles.expiredCard}>
          <p>{fetchState.message}</p>
          <button
            type="button"
            className={`${wizardStyles.btn} ${wizardStyles.btnSecondary}`}
            onClick={() => setIssueNonce((n) => n + 1)}
          >
            Try again
          </button>
        </div>
      ) : pairState.phase === 'expired' ? (
        <div className={pairStyles.expiredCard}>
          <p>This pairing code expired. Get a fresh one.</p>
          <button
            type="button"
            className={`${wizardStyles.btn} ${wizardStyles.btnSecondary}`}
            onClick={() => setIssueNonce((n) => n + 1)}
          >
            Generate a new code
          </button>
        </div>
      ) : SMS_ENABLED ? (
        <div className={pairStyles.pairBody}>
          <QRCard qrDataUrl={fetchState.qrDataUrl} qrUrl={fetchState.qrUrl} />
          <SMSForm token={fetchState.token} />
        </div>
      ) : (
        <div className={pairStyles.qrAlone}>
          <QRCard qrDataUrl={fetchState.qrDataUrl} qrUrl={fetchState.qrUrl} />
        </div>
      )}

      <div className={styles.turnActions} style={{ marginTop: 8 }}>
        <button
          type="button"
          className={`${wizardStyles.btn} ${wizardStyles.btnGhost}`}
          onClick={skip}
        >
          I&rsquo;ll do this later
        </button>
      </div>
    </div>
  )
}
