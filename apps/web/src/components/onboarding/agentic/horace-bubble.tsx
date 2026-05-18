import styles from './agentic-shell.module.css'
import { BackgroundPill } from './background-pill'
import type { Pill } from './turn-controller'

interface Props {
  text: string
  pills?: Pill[]
}

/** A Horace-voiced message. Left-aligned, parchment on charcoal, with
 *  optional background-work pills underneath. The pills carry the
 *  "show background work as it happens" reading the brief calls for. */
export function HoraceBubble({ text, pills = [] }: Props) {
  return (
    <div className={styles.bubbleRow} data-role="horace">
      <div className={styles.bubble} data-role="horace">
        <p className={styles.bubbleText}>{text}</p>
        {pills.length > 0 ? (
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
