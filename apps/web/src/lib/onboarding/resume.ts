import type { OnboardingStep } from './state'

/**
 * Map last_completed_step to the agentic turn the agent should land on.
 *
 * Turn ↔ step mapping (from the v2 plan):
 *   T0  intro      — no DB write, agent is still at 'profile'
 *   T1  greet      — no DB write, still 'profile'
 *   T2  script     — completing marks 'script'
 *   T3  patch      — completing marks 'core_markets'
 *   T4  contacts   — completing marks 'contacts'
 *   T5  notify     — completing marks 'notify'
 *   T6  pair       — completing marks 'pair'
 *   T7  live       — completing marks 'done', then redirect to /dashboard
 *
 * An agent who completed 'script' resumes at T3 (next thing to do).
 * NULL / 'profile' means they haven't done any post-signup step, so we
 * land them at T0 to re-establish the conversational context — Horace
 * re-introduces himself and walks them in. That's intentional: chat
 * onboarding shouldn't skip the opening beats just because a refresh
 * happened.
 */
export type TurnId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export function resumeTurnId(
  lastCompleted: OnboardingStep | null | undefined,
): TurnId {
  switch (lastCompleted) {
    case 'script':
      return 3
    case 'core_markets':
      return 4
    case 'contacts':
      return 5
    case 'notify':
      return 6
    case 'pair':
      return 7
    case 'done':
      // Shouldn't reach here — bootstrap redirects 'done' to /dashboard.
      // Fall back to T7 so the agent at least sees the sample signals.
      return 7
    case 'profile':
    case null:
    case undefined:
    default:
      return 0
  }
}
