'use client'

import Link from 'next/link'
import styles from './agentic-shell.module.css'
import { ui } from './copy'
import { persistOnboardingFlow } from './persist-flow'

/** Persistent "Use the classic setup instead" link, mounted top-right
 *  of every turn. Click also writes `agents.onboarding_flow = 'classic'`
 *  so subsequent reloads of /onboarding go straight to the classic
 *  wizard rather than re-bouncing through the agentic shell.
 *
 *  prefetch={false} keeps the bail-target wizard from loading until
 *  the agent actually chooses to bail. */
export function EscapeHatch() {
  return (
    <Link
      href="/onboarding/classic"
      className={styles.escapeHatch}
      prefetch={false}
      onClick={() => persistOnboardingFlow('classic')}
    >
      {ui.useClassic}
    </Link>
  )
}
