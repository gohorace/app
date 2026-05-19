'use client'

import { SignalCard, type DigestSignal } from './signal-card'

/**
 * SignalCardHero — the v2 lead-of-the-day variant of `SignalCard`.
 *
 * Wraps the standard card with `hero` set so the shell picks up the
 * gradient bg, Sparkles eyebrow, larger avatar, and terracotta primary
 * action. Splitting this into its own file (per HOR-244) keeps the
 * import sites unambiguous — pages render `SignalCardHero` for
 * `signals[0]` and `SignalCard` for the rest, without a `hero` prop on
 * the call site that's easy to miss in code review.
 *
 * The hero treatment lives entirely in `signal-card.tsx`'s shell, which
 * means tweaking the gradient or eyebrow only touches one place.
 */
export function SignalCardHero({ signal }: { signal: DigestSignal }) {
  return <SignalCard signal={signal} hero />
}
