import clsx from 'clsx'
import { X } from 'lucide-react'
import styles from '../handbook.module.css'

type Props = {
  open: boolean
  onClose: () => void
  qrSvg: string | null
  fallbackUrl: string
}

export function PhonePopover({ open, onClose, qrSvg, fallbackUrl }: Props) {
  return (
    <div className={clsx(styles.pop, open && styles.open)} role="dialog" aria-modal="true" aria-hidden={!open}>
      <button type="button" className={styles.popClose} onClick={onClose} aria-label="Close">
        <X />
      </button>
      <h3>Read it on your phone</h3>
      <p className={styles.popSub}>
        Point your camera at the code — the handbook opens on your phone so you can finish it later, or on the train.
      </p>
      <div className={styles.qrBox}>
        {qrSvg ? (
          <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
        ) : (
          <div className={styles.qrFallback}>{fallbackUrl}</div>
        )}
      </div>
      <p className={styles.qrHint}>Scan with your camera</p>
    </div>
  )
}
