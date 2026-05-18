'use client'

import { useState } from 'react'
import Link from 'next/link'
import wizardStyles from '../onboarding.module.css'
import styles from './agentic-shell.module.css'

/**
 * Agentic onboarding shell — PR 1 stub.
 *
 * Renders Turn 0 (intro + "Let's go" CTA) and the persistent escape
 * hatch that bails to the classic wizard. PR 2 will swap the centered
 * hero for the proper chat surface (message bubbles, background-work
 * pills, primary-input dock, reducer-backed turn controller).
 *
 * Props mirror what bootstrapOnboardingContext() returns so this signature
 * is stable as later turns light up.
 */
interface Props {
  agentId: string
  snippetKey: string
  appUrl: string
  firstName: string | null
}

export function AgenticShell({ firstName }: Props) {
  const [advanced, setAdvanced] = useState(false)
  // agentId, snippetKey, appUrl are wired here in PR 1 as a stable contract
  // but unused until PR 2 + later turns. Suppress the unused-vars lint via
  // the destructure above being partial; they're available on Props for
  // downstream PRs.

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandDot} aria-hidden />
          <span>Horace</span>
        </div>
        <Link
          href="/onboarding/classic"
          className={styles.escapeHatch}
          prefetch={false}
        >
          Use the classic setup instead
        </Link>
      </header>

      <main id="onboarding-main" className={styles.main}>
        {!advanced ? (
          <div className={styles.stage}>
            <p className={styles.horaceLine}>G&rsquo;day. I&rsquo;m Horace.</p>
            <p className={styles.horaceLine}>
              I&rsquo;ll get myself set up while we talk &mdash; your details,
              your site, your patch, your contacts. Takes a few minutes.
              I&rsquo;ll do most of the work.
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={`${wizardStyles.btn} ${wizardStyles.btnPrimary}`}
                onClick={() => setAdvanced(true)}
              >
                Let&rsquo;s go
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.stage}>
            <p className={styles.horaceLine}>
              {firstName ? `Got it, ${firstName}.` : 'Got it.'}
            </p>
            <p className={styles.placeholder}>
              More turns wire up in PR 2. Bail to classic any time via the
              link top-right.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
