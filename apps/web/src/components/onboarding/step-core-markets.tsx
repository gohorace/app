'use client'

/**
 * Onboarding step — "Where you work."
 *
 * Slot: between StepScript and StepContacts. Per HOR-189 brief: an
 * agent picks 1–3 suburbs that define their patch; the import job
 * (HOR-193) bulk-loads every G-NAF address in those suburbs into the
 * agent's workspace and auto-matches existing contacts.
 *
 * Skippable. The Properties screen empty state (HOR-195) drives
 * completion when skipped — we just persist the step marker so the
 * wizard advances and doesn't show this again unless the agent
 * archives all their markets later.
 *
 * UI parity: matches StepContacts shape — pane meta, title, sub,
 * primary affordance, action row. Reuses Horace's terracotta accent
 * for the primary CTA and the SuburbPicker chips.
 */

import { useState } from 'react'
import { ArrowRight, ArrowLeft, Check } from 'lucide-react'
import styles from './onboarding.module.css'
import stepStyles from './step-core-markets.module.css'
import {
  LocationPicker,
  placeKey,
  placeToPostBody,
  type SelectedPlace,
} from '@/components/core-markets/location-picker'

interface Props {
  stepNumber: number
  totalSteps: number
  onNext: () => void
  onBack: () => void
}

const MIN_REQUIRED = 1
const MAX_ALLOWED  = 3

export function StepCoreMarkets({ stepNumber, totalSteps, onNext, onBack }: Props) {
  const [selected, setSelected] = useState<SelectedPlace[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Places successfully posted in this submit attempt. */
  const [accepted, setAccepted] = useState<SelectedPlace[]>([])

  const canSubmit = selected.length >= MIN_REQUIRED && !submitting

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    const newlyAccepted: SelectedPlace[] = []
    try {
      // Sequential — three POSTs max, each ~150ms. Stopping on the first
      // failure means the agent sees a clean inline error without trying
      // to reason about partial success across N requests.
      for (const s of selected) {
        const key = placeKey(s)
        // Skip ones already posted (in case the agent retries after a
        // mid-list failure).
        if (accepted.some((a) => placeKey(a) === key)) {
          newlyAccepted.push(s)
          continue
        }
        const res = await fetch('/api/core-markets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(placeToPostBody(s)),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          setAccepted([...accepted, ...newlyAccepted])
          setError(body.error ?? `Couldn't add ${s.label}. Try again?`)
          return
        }
        newlyAccepted.push(s)
      }

      // All accepted — advance.
      setAccepted([...accepted, ...newlyAccepted])
      onNext()
    } catch {
      setError('Network error — please try again.')
      setAccepted([...accepted, ...newlyAccepted])
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.stepFade}>
      <div className={styles.paneMeta}>
        <span>Your patch</span>
        <span className={styles.paneMetaDivider} />
        <span>Step {stepNumber} of {totalSteps}</span>
      </div>

      <h1 className={styles.paneTitle}>Where you work.</h1>
      <p className={styles.paneSub}>
        Pick up to three patches you cover — a whole suburb, a single
        street, or one building. Horace brings in every address inside
        them and tells you the moment a contact you know moves on one.
      </p>

      <div className={stepStyles.pickerCard}>
        <LocationPicker
          selected={selected}
          onChange={setSelected}
          min={MIN_REQUIRED}
          max={MAX_ALLOWED}
          autoFocus
        />

        <div className={stepStyles.helpText}>
          {selected.length === 0
            ? `Choose between ${MIN_REQUIRED} and ${MAX_ALLOWED} places. You can change these anytime in Settings.`
            : selected.length < MAX_ALLOWED
              ? `${selected.length} selected. Add up to ${MAX_ALLOWED - selected.length} more, or continue.`
              : 'Three locked in. Nice patch.'}
        </div>

        {accepted.length > 0 && (
          <div className={stepStyles.acceptedNote}>
            <Check size={14} aria-hidden />
            <span>
              Importing {accepted.length} {accepted.length === 1 ? 'place' : 'places'} in the background — Horace will whisper when it&rsquo;s done.
            </span>
          </div>
        )}

        {error && <p className={stepStyles.error}>{error}</p>}
      </div>

      <div className={styles.paneActions}>
        <button
          className={`${styles.btn} ${styles.btnGhost}`}
          onClick={onBack}
          type="button"
          disabled={submitting}
        >
          <ArrowLeft size={14} /> Back
        </button>
        <div className={styles.paneActionsRight}>
          <button
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={onNext}
            type="button"
            disabled={submitting}
          >
            Skip for now
          </button>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={submit}
            type="button"
            disabled={!canSubmit}
          >
            {submitting
              ? 'Adding…'
              : selected.length > 1
                ? 'Add these markets'
                : 'Add this market'}
            {!submitting && <ArrowRight size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}
