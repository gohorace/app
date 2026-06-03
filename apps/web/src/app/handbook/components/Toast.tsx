import clsx from 'clsx'
import { Check } from 'lucide-react'
import styles from '../handbook.module.css'

export function Toast({ message, show }: { message: string; show: boolean }) {
  return (
    <div className={clsx(styles.toast, show && styles.show)} role="status" aria-live="polite">
      <Check />
      <span>{message}</span>
    </div>
  )
}
