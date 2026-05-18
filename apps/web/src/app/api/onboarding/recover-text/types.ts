/**
 * Shared types for /api/onboarding/recover-text.
 *
 * Lives in a sibling module — Next.js 14 disallows non-route exports
 * from route.ts (same pattern as site-probe/validate.ts).
 */

/** Modes the recovery endpoint supports.
 *   • 'patch' — agent typed free text in Turn 3 (e.g. "northern
 *               beaches"). We extract candidate suburb names via LLM
 *               and re-validate each through search_localities so the
 *               UI only ever sees real locality_pids.
 *   • 'rescue' — agent typed something unparseable twice on ANY turn.
 *                LLM writes a one-sentence Horace line offering retry
 *                or bail. Optional context lets the prompt know which
 *                turn the input came from for tone calibration. */
export type RecoveryTurn = 'patch' | 'rescue'

export interface RecoverTextRequest {
  turn: RecoveryTurn
  /** Free-text input the agent typed. Capped at 200 chars server-side. */
  input: string
  /** Optional turn context for the LLM prompt — e.g. on 'patch' the
   *  caller can pass already-selected suburb names to disambiguate. */
  context?: {
    selectedSuburbs?: string[]
    /** For 'rescue' mode: the human-readable name of the turn the
     *  agent got stuck on. Used purely to colour the prompt; never
     *  shown to the agent. */
    turnLabel?: string
  }
}

export interface SuburbCandidate {
  locality_pid: string
  locality_name: string
  state_abbrev: string
  postcode: string | null
}

export type RecoverTextResponse =
  | { kind: 'suburb_candidates'; items: SuburbCandidate[] }
  | {
      kind: 'rescue'
      horace_line: string
      suggested_next_action: 'retry' | 'bail' | 'continue'
    }
  | { kind: 'rate_limited'; retry_after_seconds: number }
  | { kind: 'error'; message: string }
