import Link from 'next/link'
import styles from './agentic-shell.module.css'
import { ui } from './copy'

/** Persistent "Use the classic setup instead" link, mounted top-right
 *  of every turn. prefetch={false} keeps the bail-target wizard from
 *  loading until the agent actually chooses to bail. */
export function EscapeHatch() {
  return (
    <Link href="/onboarding/classic" className={styles.escapeHatch} prefetch={false}>
      {ui.useClassic}
    </Link>
  )
}
