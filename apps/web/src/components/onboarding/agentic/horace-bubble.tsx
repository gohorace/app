import styles from './agentic-shell.module.css'
import { BackgroundPill } from './background-pill'
import type { Pill } from './turn-controller'

interface Props {
  text: string
  pills?: Pill[]
}

/** A Horace-voiced message. Left-aligned, parchment on charcoal, with
 *  optional background-work pills underneath. The pills carry the
 *  "show background work as it happens" reading the brief calls for.
 *
 *  Empty text + pills is valid — Horace's "action" sometimes IS the
 *  background work (e.g. probing the site after the agent confirms a
 *  URL). In that case we render just the pill row, no empty bubble. */
export function HoraceBubble({ text, pills = [] }: Props) {
  const hasText = text.trim().length > 0
  const hasPills = pills.length > 0
  if (!hasText && !hasPills) return null

  if (!hasText && hasPills) {
    return (
      <div className={styles.bubbleRow} data-role="horace">
        <div className={styles.pillRow}>
          {pills.map((p) => (
            <BackgroundPill key={p.id} pill={p} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.bubbleRow} data-role="horace">
      <div className={styles.bubble} data-role="horace">
        {hasText ? <p className={styles.bubbleText}>{text}</p> : null}
        {hasPills ? (
          <div className={styles.pillRow}>
            {pills.map((p) => (
              <BackgroundPill key={p.id} pill={p} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
