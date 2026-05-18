/**
 * Turn controller — the reducer + types backing the agentic onboarding
 * shell. State is client-only; persistence is via the existing
 * /api/onboarding/step route + markStepComplete (turn N ↔ step N).
 *
 * Design goals:
 *   • One source of truth for what Horace has said and what work is in
 *     flight. Bubbles and pills both render straight off this state.
 *   • Pills live inside the most recent Horace message — adding a new
 *     Horace message creates a fresh pill slot. This matches the brief's
 *     "show background work as it happens" reading.
 *   • Per-turn unparseable counter, surfaced as bailVisible after 2
 *     strikes. The shell renders <BailPrompt /> off bailVisible.
 */

export type { TurnId } from '@/lib/onboarding/resume'
import type { TurnId } from '@/lib/onboarding/resume'

export type PillKind = 'work' | 'ok' | 'err'

export interface Pill {
  id: string
  kind: PillKind
  label: string
}

export type Role = 'horace' | 'user'

export interface Message {
  id: string
  role: Role
  /** Renders as one line of text. Multi-line Horace turns dispatch
   *  multiple 'horace_says' actions so each bubble is its own message. */
  text: string
  /** Pills are owned by Horace messages; user messages ignore this slot. */
  pills: Pill[]
}

export interface State {
  turnId: TurnId
  history: Message[]
  /** Per-turn count of unparseable inputs. Reset on advance. */
  unparseable: Record<TurnId, number>
  /** True once unparseable[currentTurn] >= 2 or a turn explicitly
   *  dispatches show_bail (site-probe / CSV failures). */
  bailVisible: boolean
}

export type Action =
  | { type: 'horace_says'; text: string; pills?: Pill[] }
  | { type: 'user_says'; text: string }
  | { type: 'pill_add'; pill: Pill }
  | { type: 'pill_update'; id: string; patch: Partial<Omit<Pill, 'id'>> }
  | { type: 'advance'; to: TurnId }
  | { type: 'unparseable_inc' }
  | { type: 'show_bail' }
  | { type: 'hide_bail' }

let _seq = 0
function nextId(prefix: string): string {
  _seq += 1
  return `${prefix}_${_seq}`
}

export function createInitialState(turnId: TurnId = 0): State {
  return {
    turnId,
    history: [],
    unparseable: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 },
    bailVisible: false,
  }
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'horace_says':
      return {
        ...state,
        history: [
          ...state.history,
          {
            id: nextId('m'),
            role: 'horace',
            text: action.text,
            pills: action.pills ?? [],
          },
        ],
      }

    case 'user_says':
      return {
        ...state,
        history: [
          ...state.history,
          { id: nextId('m'), role: 'user', text: action.text, pills: [] },
        ],
      }

    case 'pill_add': {
      // Attach to the most recent Horace message — pills belong to the
      // line Horace just delivered, not the user's reply.
      const idx = lastHoraceIdx(state.history)
      if (idx < 0) return state
      const next = state.history.slice()
      next[idx] = { ...next[idx], pills: [...next[idx].pills, action.pill] }
      return { ...state, history: next }
    }

    case 'pill_update': {
      const next = state.history.slice()
      for (let i = next.length - 1; i >= 0; i -= 1) {
        const m = next[i]
        const pIdx = m.pills.findIndex((p) => p.id === action.id)
        if (pIdx >= 0) {
          const pills = m.pills.slice()
          pills[pIdx] = { ...pills[pIdx], ...action.patch }
          next[i] = { ...m, pills }
          break
        }
      }
      return { ...state, history: next }
    }

    case 'advance':
      return {
        ...state,
        turnId: action.to,
        bailVisible: false,
      }

    case 'unparseable_inc': {
      const t = state.turnId
      const n = (state.unparseable[t] ?? 0) + 1
      return {
        ...state,
        unparseable: { ...state.unparseable, [t]: n },
        bailVisible: n >= 2 ? true : state.bailVisible,
      }
    }

    case 'show_bail':
      return { ...state, bailVisible: true }

    case 'hide_bail':
      return { ...state, bailVisible: false }
  }
}

function lastHoraceIdx(history: Message[]): number {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].role === 'horace') return i
  }
  return -1
}

/** Helpers for turn components to mint ids without touching the reducer. */
export function makePill(kind: PillKind, label: string): Pill {
  return { id: nextId('p'), kind, label }
}
