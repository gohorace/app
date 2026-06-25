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

/** Outreach channel the dock opens in. Email is the default + the only channel
 *  with a backend send pipeline today; SMS is copy-to-clipboard and Call is
 *  reference-only (Outreach Review re-skin). */
export type ComposerChannel = 'email' | 'sms' | 'call'

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
  /** Recipient email. Optional — when omitted (Stream/Companion only carry a
   *  contactId), the dock resolves it from the contact record on open. */
  recipient?: string
  contactName?: string | null
  signalContext?: ComposerSignalContext
  /** Companion opens already drafting; Stream + Contact offer the draft. */
  autoDraft?: boolean
  /** A draft already produced upstream (e.g. the Companion conversation) — the
   *  dock opens pre-filled in the `drafted` state instead of re-generating. */
  draft?: { subject: string; body: string }
  /** Which UI surface opened the dock — preserved for send attribution. */
  source: Extract<EmailSendSource, 'stream' | 'contact' | 'companion'>
  /** Channel to land in when the V3 dock is enabled. Defaults to 'email'.
   *  Ignored by the V2 (email-only) shell. */
  defaultChannel?: ComposerChannel
  /** Recipient phone (E.164 or local-format string) for the SMS/Call channels
   *  in the V3 dock. Optional — when omitted the dock resolves it from the
   *  contact record on open. */
  recipientPhone?: string | null
}

/** Public API exposed by `useComposerDock()`. */
export interface ComposerDockContextValue {
  /** True when at least one composer dock is open. */
  open: boolean
  openComposer: (opts: OpenComposerOptions) => void
  /** Close one dock by id, or the most-recently-opened when called with no id. */
  closeComposer: (id?: string) => void
}
