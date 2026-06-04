import clsx from 'clsx'
import { X } from 'lucide-react'
import styles from '../manifesto.module.css'

type Props = {
  show: boolean
  onResume: () => void
  onDismiss: () => void
}

export function ResumeBanner({ show, onResume, onDismiss }: Props) {
  return (
    <div className={clsx(styles.resume, show && styles.show)}>
      <span>Pick up where you left off?</span>
      <button type="button" className={styles.rGo} onClick={onResume}>
        Resume reading
      </button>
      <button type="button" className={styles.rX} onClick={onDismiss} aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  )
}
