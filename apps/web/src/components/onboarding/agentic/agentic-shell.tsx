'use client'

import { useCallback, useReducer } from 'react'
import styles from './agentic-shell.module.css'
import { BailPrompt } from './bail-prompt'
import { EscapeHatch } from './escape-hatch'
import { HoraceBubble } from './horace-bubble'
import { UserBubble } from './user-bubble'
import {
  createInitialState,
  reducer,
  type TurnId,
} from './turn-controller'
import { Turn0Intro } from './turns/turn-0-intro'
import { Turn1Greet } from './turns/turn-1-greet'
import { Turn2Script } from './turns/turn-2-script'
import { Turn3Patch } from './turns/turn-3-patch'
import { Turn4Contacts } from './turns/turn-4-contacts'
import { Turn5Notify } from './turns/turn-5-notify'
import { Turn6Pair } from './turns/turn-6-pair'
import { Turn7Live } from './turns/turn-7-live'

/**
 * Agentic onboarding shell — the chat surface.
 *
 * State sits in a single reducer (turn-controller.ts). Turns render as
 * thin components that:
 *   • dispatch horace_says on mount to push their lines into history,
 *   • own their primary input + background work,
 *   • call onAdvance() when complete.
 *
 * Bail mechanics:
 *   • Header link (always mounted) routes to /onboarding/classic.
 *   • Inline bail-prompt slides in beneath the last bubble when
 *     state.bailVisible flips (twice-unparseable or explicit
 *     show_bail from a turn — site-probe / CSV failures, etc.).
 *
 * Props mirror bootstrapOnboardingContext() so adding more context
 * (workspaceId, snippet, …) for later turns is additive.
 */
interface Props {
  agentId: string
  snippetKey: string
  appUrl: string
  firstName: string | null
  /** Auth email — used by Turn 2 to suggest the agent's site domain. */
  email: string
  initialTurnId?: TurnId
}

export function AgenticShell({
  snippetKey,
  appUrl,
  firstName,
  email,
  initialTurnId = 0,
}: Props) {
  const [state, dispatch] = useReducer(reducer, createInitialState(initialTurnId))

  const advance = useCallback(
    (to: TurnId) => dispatch({ type: 'advance', to }),
    [],
  )

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandDot} aria-hidden />
          <span>Horace</span>
        </div>
        <EscapeHatch />
      </header>

      <main id="onboarding-main" className={styles.main}>
        <div className={styles.stage}>
          <div className={styles.history}>
            {state.history.map((m) =>
              m.role === 'horace' ? (
                <HoraceBubble key={m.id} text={m.text} pills={m.pills} />
              ) : (
                <UserBubble key={m.id} text={m.text} />
              ),
            )}
          </div>

          <div className={styles.turnSlot} key={`turn-${state.turnId}`}>
            {state.turnId === 0 ? (
              <Turn0Intro dispatch={dispatch} onAdvance={() => advance(1)} />
            ) : state.turnId === 1 ? (
              <Turn1Greet
                firstName={firstName}
                dispatch={dispatch}
                onAdvance={() => advance(2)}
              />
            ) : state.turnId === 2 ? (
              <Turn2Script
                email={email}
                snippetKey={snippetKey}
                appUrl={appUrl}
                dispatch={dispatch}
                onAdvance={() => advance(3)}
              />
            ) : state.turnId === 3 ? (
              <Turn3Patch dispatch={dispatch} onAdvance={() => advance(4)} />
            ) : state.turnId === 4 ? (
              <Turn4Contacts dispatch={dispatch} onAdvance={() => advance(5)} />
            ) : state.turnId === 5 ? (
              <Turn5Notify dispatch={dispatch} onAdvance={() => advance(6)} />
            ) : state.turnId === 6 ? (
              <Turn6Pair dispatch={dispatch} onAdvance={() => advance(7)} />
            ) : state.turnId === 7 ? (
              <Turn7Live firstName={firstName} dispatch={dispatch} />
            ) : (
              <TurnPlaceholder turnId={state.turnId} />
            )}
          </div>

          {state.bailVisible ? <BailPrompt /> : null}
        </div>
      </main>
    </div>
  )
}

/** Stand-in for turns 2–7 (wire up in later PRs). Renders nothing
 *  Horace-voiced — purely a build-time signpost so the agent never sees
 *  raw "TODO" prose. */
function TurnPlaceholder({ turnId }: { turnId: TurnId }) {
  return (
    <p className={styles.placeholder}>
      Next: Turn {turnId}. Wires up in a later PR. Bail any time via the
      link top-right.
    </p>
  )
}
