/**
 * Types for the Communication V2 tracked-email composer dock (HOR-354).
 *
 * The dock is a single modeless surface opened from three entry points
 * (Stream, Contact header, Companion). The surfaces differ only in the
 * context payload and one behavioural rule — whether Horace auto-drafts on
 * open. See `composer-dock-context.tsx` for the provider.
 */

import type { EmailSendSource } from './types'

/**
 * The assist lifecycle. Drives the dock body. Full machine:
 *   empty → drafting → drafted → edited → sending
 * plus the honest failure paths and the setup-required outcome.
 */
export type ComposerScenario =
  | 'empty'
  | 'drafting'
  | 'drafted'
  | 'edited'
  | 'sending'
  | 'failed-draft'
  | 'failed-send'
  | 'setup'

/** Recipient-compliance guardrail (detachable layer #3). */
export type ComposerGuardrail = null | 'unsubscribed' | 'excluded' | 'untracked'

/**
 * Lightweight signal context passed from the Stream / Companion so the draft
 * endpoint can pre-load the moment that triggered the compose. Kept loose —
 * the draft route derives its own pretext server-side; this is only a hint.
 */
export interface ComposerSignalContext {
  /** Human label for the moment, e.g. "Opened your last email twice". */
  label?: string
  /** Suburb / property / signal id the moment relates to, if any. */
  detail?: string
}

/**
 * Args supplied by an entry point when opening the dock. `autoDraft` is
 * `true` only from the Companion (the agent just accepted Horace's tap).
 */
export interface OpenComposerOptions {
  contactId: string
  recipient: string
  contactName?: string | null
  signalContext?: ComposerSignalContext
  /** Companion opens already drafting; Stream + Contact offer the draft. */
  autoDraft?: boolean
  /** Which UI surface opened the dock — preserved for send attribution. */
  source: Extract<EmailSendSource, 'stream' | 'contact' | 'companion'>
}

/** Public API exposed by `useComposerDock()`. */
export interface ComposerDockContextValue {
  /** True when at least one composer dock is open. */
  open: boolean
  openComposer: (opts: OpenComposerOptions) => void
  /** Close one dock by id, or the most-recently-opened when called with no id. */
  closeComposer: (id?: string) => void
}
