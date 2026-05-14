'use client'

import { ArrowRight, ArrowLeft } from 'lucide-react'
import styles from './onboarding.module.css'

/**
 * StepPair — placeholder for HOR-56 "Take Horace with you".
 *
 * This file lands in HOR-56.1 (foundations) so the wizard compiles
 * with the new 'pair' step inserted between 'notify' and 'done'.
 * The real UI — QR card, SMS form, paired state, polling — is built
 * in HOR-56.3.
 *
 * For now: a stub that renders the spec headline, a "Skip for now"
 * link to keep onboarding unblocked in dev, and a Continue button
 * that advances to the reveal. Once HOR-56.3 lands, this file is
 * replaced wholesale with the real step-pair.tsx.
 */
interface Props {
  stepNumber: number
  totalSteps: number
  onNext: () => void
  onBack: () => void
}

export function StepPair({ stepNumber, totalSteps, onNext, onBack }: Props) {
  return (
    <div className={styles.stepFade}>
      <div className={styles.paneMeta}>
        <span>Mobile push</span>
        <span className={styles.paneMetaDivider} />
        <span>Step {stepNumber} of {totalSteps}</span>
      </div>
      <h1 className={styles.paneTitle}>Take Horace with you.</h1>
      <p className={styles.paneSub}>
        Most signals land while you&rsquo;re between meetings — at the listing, in the car, before coffee.
        Add Horace to your home screen for one-tap access and push alerts.
      </p>

      {/* Placeholder body — real UI (QR / SMS / paired state) lands in HOR-56.3. */}
      <div style={{ padding: '24px 0', opacity: 0.7 }}>
        <p>Mobile pairing UI coming soon (HOR-161).</p>
      </div>

      <div className={styles.paneActions}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGhost}`}
          onClick={onBack}
        >
          <ArrowLeft size={14} /> Back
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={onNext}
        >
          Continue <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}
