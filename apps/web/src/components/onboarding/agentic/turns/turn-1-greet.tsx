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
 *  conversation, not a teleprompter. */
export function Turn1Greet({ firstName, dispatch, onAdvance }: Props) {
  const didMount = useRef(false)

  useEffect(() => {
    if (didMount.current) return
    didMount.current = true
    dispatch({ type: 'horace_says', text: horace.t1_greet(firstName) })
    dispatch({ type: 'horace_says', text: horace.t1_greet_sub() })
    const t = setTimeout(onAdvance, 2200)
    return () => clearTimeout(t)
  }, [dispatch, firstName, onAdvance])

  // No primary input — the turn auto-advances. The shell renders the
  // bubbles from history.
  return null
}
