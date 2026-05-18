'use client'

import Link from 'next/link'
import wizardStyles from '../onboarding.module.css'
import styles from './agentic-shell.module.css'
import { ui } from './copy'
import { persistOnboardingFlow } from './persist-flow'

/** Inline bail affordance — slides in beneath the last bubble after a
 *  turn flips bailVisible (twice-unparseable, site-probe failures, CSV
 *  parse failures). The persistent header link is the always-available
 *  escape; this is the contextual nudge for "you're stuck, take the out".
 *
 *  Click also writes `agents.onboarding_flow = 'classic'` so subsequent
 *  reloads of /onboarding go straight to the classic wizard.
 *
 *  Visually distinct from a Horace bubble so the agent reads it as the
 *  system offering help, not Horace himself speaking. */
export function BailPrompt() {
  return (
    <div className={styles.bailPrompt} role="region" aria-label="Switch to classic setup">
      <p className={styles.bailPromptHeading}>{ui.bailPromptHeading}</p>
      <Link
        href="/onboarding/classic"
        className={`${wizardStyles.btn} ${wizardStyles.btnSecondary}`}
        prefetch={false}
        onClick={() => persistOnboardingFlow('classic')}
      >
        {ui.bailPromptCta}
      </Link>
    </div>
  )
}
