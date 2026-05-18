'use client'

import { useEffect, useRef } from 'react'
import wizardStyles from '../../onboarding.module.css'
import styles from '../agentic-shell.module.css'
import { horace, ui } from '../copy'
import type { Action } from '../turn-controller'

interface Props {
  dispatch: React.Dispatch<Action>
  onAdvance: () => void
}

/** Turn 0 — Horace introduces himself. Two Horace lines (intro + what
 *  we're about to do together) and a single "Let's go" CTA. No
 *  background work, no DB write — the agent is still in profile-
 *  complete state from signup.
 *
 *  The two lines dispatch on mount as separate messages so each gets
 *  its own bubble in history. The CTA is the only input. */
export function Turn0Intro({ dispatch, onAdvance }: Props) {
  const didMount = useRef(false)

  useEffect(() => {
    if (didMount.current) return
    didMount.current = true
    dispatch({ type: 'horace_says', text: horace.t0_intro_a() })
    dispatch({ type: 'horace_says', text: horace.t0_intro_b() })
  }, [dispatch])

  return (
    <div className={styles.turnActions}>
      <button
        type="button"
        className={`${wizardStyles.btn} ${wizardStyles.btnPrimary}`}
        onClick={onAdvance}
      >
        {ui.letsGo}
      </button>
    </div>
  )
}
