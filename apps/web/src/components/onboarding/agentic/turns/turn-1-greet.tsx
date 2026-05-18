'use client'

import { useEffect, useRef } from 'react'
import { horace } from '../copy'
import type { Action } from '../turn-controller'

interface Props {
  firstName: string | null
  dispatch: React.Dispatch<Action>
  onAdvance: () => void
}

/** Turn 1 — Horace greets the agent by first name.
 *
 *  Signup already captured first/last name, agency, mobile so there's
 *  nothing to ask. Two lines (greet + the quiet promise about not
 *  pinging unless it matters) then a beat, then we auto-advance to
 *  Turn 2. The pause is intentional — the brief reads as a
 *  conversation, not a teleprompter.
 *
 *  Implementation note: onAdvance is a fresh arrow from the shell on
 *  every render (`() => advance(2)`). If we listed it in the useEffect
 *  deps we'd clear+reschedule the timeout on every shell re-render —
 *  and because the dispatches in this effect cause a re-render, the
 *  cleanup would fire BEFORE the timeout could elapse. Reading the
 *  latest onAdvance via a ref breaks that cycle: the effect mounts
 *  exactly once, the timeout fires once, the ref always holds the
 *  current callback. Seen as the "stalls at T1" preview bug.
 */
export function Turn1Greet({ firstName, dispatch, onAdvance }: Props) {
  const didMount = useRef(false)
  const onAdvanceRef = useRef(onAdvance)
  onAdvanceRef.current = onAdvance

  useEffect(() => {
    if (didMount.current) return
    didMount.current = true
    dispatch({ type: 'horace_says', text: horace.t1_greet(firstName) })
    dispatch({ type: 'horace_says', text: horace.t1_greet_sub() })
    const t = setTimeout(() => onAdvanceRef.current(), 2200)
    return () => clearTimeout(t)
  }, [dispatch, firstName])

  return null
}
