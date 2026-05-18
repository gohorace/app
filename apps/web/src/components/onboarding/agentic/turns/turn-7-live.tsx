'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Sparkles } from 'lucide-react'
import revealStyles from '../../step-reveal.module.css'
import wizardStyles from '../../onboarding.module.css'
import styles from '../agentic-shell.module.css'
import { horace, ui } from '../copy'
import { markStepComplete } from '../mark-step'
import { type Action } from '../turn-controller'
import { SAMPLES } from './_shared/sample-signals'

interface Props {
  firstName: string | null
  dispatch: React.Dispatch<Action>
}

/** Turn 7 — live reveal.
 *
 *  The only turn that carries the "Seize the moment — Horace" sign-off
 *  (enforced by the voice tests). Renders the three sample signals
 *  shared with v1's StepReveal, plus a CTA to /dashboard. Polls
 *  /api/onboarding/verify-snippet so if a real first signal lands
 *  while the agent is reading, we flip the banner copy from "samples"
 *  to "the first real visit just landed". */
export function Turn7Live({ firstName, dispatch }: Props) {
  const didMount = useRef(false)
  const router = useRouter()
  const [hasFirstSignal, setHasFirstSignal] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const firstSignalAckFired = useRef(false)

  // Opening Horace lines + sign-off, dispatched once on mount.
  useEffect(() => {
    if (didMount.current) return
    didMount.current = true
    dispatch({ type: 'horace_says', text: horace.t7_live(firstName) })
    dispatch({ type: 'horace_says', text: horace.t7_sample_intro() })
    dispatch({ type: 'horace_says', text: horace.t7_signoff() })
  }, [dispatch, firstName])

  // Poll for the first real tracker ping. If it lands while T7 is
  // open, dispatch the "first signal" line and flip the banner.
  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const res = await fetch('/api/onboarding/verify-snippet', {
          cache: 'no-store',
        })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data.verified) {
          setHasFirstSignal(true)
          if (!firstSignalAckFired.current) {
            firstSignalAckFired.current = true
            dispatch({ type: 'horace_says', text: horace.t7_first_signal() })
          }
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch {
        // transient; keep polling
      }
    }
    check()
    pollRef.current = setInterval(check, 5000)
    return () => {
      cancelled = true
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [dispatch])

  async function finish() {
    setFinishing(true)
    await markStepComplete('done')
    router.push('/dashboard')
  }

  return (
    <>
      {hasFirstSignal ? (
        <div className={revealStyles.firstSignalBanner}>
          <Sparkles size={16} />
          <span>First signal received — Horace is listening on your site.</span>
        </div>
      ) : null}

      <div className={revealStyles.dashboardMock}>
        <div className={revealStyles.mockHeader}>
          <span className={revealStyles.mockHeaderTitle}>Today’s signals</span>
          <span className={revealStyles.mockHeaderBadge}>
            {hasFirstSignal ? '1 live · 3 sample' : '3 sample'}
          </span>
        </div>
        <div className={revealStyles.mockList}>
          {SAMPLES.map((s) => (
            <div key={s.name} className={revealStyles.signalRow}>
              <div
                className={`${revealStyles.avatar} ${revealStyles[`avatar_${s.intent}`]}`}
              >
                {s.initials}
              </div>
              <div className={revealStyles.signalBody}>
                <div className={revealStyles.signalTop}>
                  <span className={revealStyles.signalName}>{s.name}</span>
                  <span className={revealStyles.signalMeta}>{s.meta}</span>
                </div>
                <div className={revealStyles.signalNudge}>{s.nudge}</div>
                <span
                  className={`${revealStyles.tag} ${revealStyles[`tag_${s.intent}`]}`}
                >
                  {s.intentLabel}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.turnActions} style={{ marginTop: 20 }}>
        <button
          type="button"
          className={`${wizardStyles.btn} ${wizardStyles.btnPrimary}`}
          onClick={finish}
          disabled={finishing}
        >
          {finishing ? 'One moment…' : ui.takeMeToDashboard}{' '}
          {!finishing && <ArrowRight size={14} />}
        </button>
      </div>
    </>
  )
}
