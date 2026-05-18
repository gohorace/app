'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, ArrowRight } from 'lucide-react'
import {
  requestPushPermission,
  savePushSubscription,
} from '@/components/push-manager'
import wizardStyles from '../../onboarding.module.css'
import styles from '../agentic-shell.module.css'
import { horace } from '../copy'
import { markStepComplete } from '../mark-step'
import { makePill, type Action } from '../turn-controller'

interface Props {
  dispatch: React.Dispatch<Action>
  onAdvance: () => void
}

type Phase = 'asking' | 'asking_browser' | 'done'
type Outcome = 'granted' | 'blocked' | 'unsupported'

/** Turn 5 — browser notifications.
 *
 *  Wraps requestPushPermission + savePushSubscription from
 *  components/push-manager. Three outcomes (granted / blocked /
 *  unsupported) each map to a distinct Horace line and all advance —
 *  the brief is clear that blocked/unsupported aren't dead ends. */
export function Turn5Notify({ dispatch, onAdvance }: Props) {
  const didMount = useRef(false)
  const onAdvanceRef = useRef(onAdvance)
  onAdvanceRef.current = onAdvance
  const [phase, setPhase] = useState<Phase>('asking')

  useEffect(() => {
    if (didMount.current) return
    didMount.current = true
    dispatch({ type: 'horace_says', text: horace.t5_ask_notify() })
  }, [dispatch])

  async function enable() {
    setPhase('asking_browser')
    dispatch({ type: 'user_says', text: 'Allow alerts' })

    // Work pill while we ask the browser.
    const pill = makePill('work', 'Asking your browser')
    dispatch({ type: 'horace_says', text: '', pills: [pill] })

    let outcome: Outcome
    if (
      typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window)
    ) {
      outcome = 'unsupported'
    } else {
      try {
        const sub = await requestPushPermission()
        if (!sub) {
          outcome = 'blocked'
        } else {
          await savePushSubscription(sub)
          outcome = 'granted'
        }
      } catch {
        outcome = 'blocked'
      }
    }

    dispatch({
      type: 'pill_update',
      id: pill.id,
      patch: {
        kind: outcome === 'granted' ? 'ok' : 'err',
        label:
          outcome === 'granted'
            ? 'Alerts enabled'
            : outcome === 'blocked'
              ? 'Alerts blocked'
              : 'Push unsupported',
      },
    })

    dispatch({
      type: 'horace_says',
      text:
        outcome === 'granted'
          ? horace.t5_granted()
          : outcome === 'blocked'
            ? horace.t5_blocked()
            : horace.t5_unsupported(),
    })

    await markStepComplete('notify')
    setPhase('done')
    // Small beat so the agent reads Horace's reaction before T6 mounts.
    setTimeout(() => onAdvanceRef.current(), 1500)
  }

  async function skip() {
    dispatch({ type: 'user_says', text: 'Skip for now' })
    dispatch({ type: 'horace_says', text: horace.t5_blocked() })
    await markStepComplete('notify')
    setPhase('done')
    setTimeout(() => onAdvanceRef.current(), 800)
  }

  if (phase === 'done') return null

  return (
    <div className={styles.turnActions}>
      <button
        type="button"
        className={`${wizardStyles.btn} ${wizardStyles.btnPrimary}`}
        onClick={enable}
        disabled={phase === 'asking_browser'}
      >
        <Bell size={14} />
        {phase === 'asking_browser' ? 'Asking…' : 'Allow alerts'}
        {phase !== 'asking_browser' && <ArrowRight size={14} />}
      </button>
      <button
        type="button"
        className={`${wizardStyles.btn} ${wizardStyles.btnGhost}`}
        onClick={skip}
        disabled={phase === 'asking_browser'}
      >
        Skip for now
      </button>
    </div>
  )
}
