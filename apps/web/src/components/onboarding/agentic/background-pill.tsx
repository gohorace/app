import styles from './agentic-shell.module.css'
import type { Pill } from './turn-controller'

interface Props {
  pill: Pill
}

/** A single background-work chip. Three states:
 *    work — a pulsing dot ("Counting listings…")
 *    ok   — solid moss check ("47 listings · WordPress detected")
 *    err  — terracotta x ("I'm not landing on it")
 *  The shell never animates from one pill to a different pill — it
 *  mutates the existing pill's `kind` + `label` via reducer
 *  pill_update. Doing it that way means the agent sees the same chip
 *  resolve in-place rather than a row that grows. */
export function BackgroundPill({ pill }: Props) {
  return (
    <span
      className={styles.pill}
      data-kind={pill.kind}
      aria-live={pill.kind === 'work' ? 'polite' : 'off'}
    >
      <span className={styles.pillIcon} aria-hidden>
        {pill.kind === 'work' ? (
          <span className={styles.pillDot} />
        ) : pill.kind === 'ok' ? (
          // simple check glyph — avoids pulling lucide for a 10px icon
          <svg viewBox="0 0 12 12" width="10" height="10">
            <path
              d="M2.5 6.5L5 9L9.5 3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" width="10" height="10">
            <path
              d="M3 3L9 9M9 3L3 9"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
      <span>{pill.label}</span>
    </span>
  )
}
