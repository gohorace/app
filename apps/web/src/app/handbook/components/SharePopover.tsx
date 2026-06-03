import clsx from 'clsx'
import { Copy, Mail, Share2, X } from 'lucide-react'
import styles from '../handbook.module.css'

type Props = {
  open: boolean
  onClose: () => void
  displayUrl: string
  emailHref: string
  onCopy: () => void
  onEmail: () => void
  onNative: () => void
  showNative: boolean
}

export function SharePopover({
  open,
  onClose,
  displayUrl,
  emailHref,
  onCopy,
  onEmail,
  onNative,
  showNative,
}: Props) {
  return (
    <div className={clsx(styles.pop, open && styles.open)} role="dialog" aria-modal="true" aria-hidden={!open}>
      <button type="button" className={styles.popClose} onClick={onClose} aria-label="Close">
        <X />
      </button>
      <h3>Pass it to a colleague</h3>
      <p className={styles.popSub}>
        Know an agent who&rsquo;s tired of waiting for the phone to ring? Send it their way.
      </p>
      <div className={styles.shareRow}>
        <button type="button" className={styles.shareAct} onClick={onCopy}>
          <span className={styles.ico}>
            <Copy />
          </span>
          <span className={styles.saBody}>
            Copy link<small>{displayUrl}</small>
          </span>
        </button>
        <a className={styles.shareAct} href={emailHref} onClick={onEmail}>
          <span className={styles.ico}>
            <Mail />
          </span>
          <span className={styles.saBody}>
            Email it<small>Opens your mail with a note ready to go</small>
          </span>
        </a>
        {showNative && (
          <button type="button" className={styles.shareAct} onClick={onNative}>
            <span className={styles.ico}>
              <Share2 />
            </span>
            <span className={styles.saBody}>
              Share&hellip;<small>Messages, WhatsApp, wherever you like</small>
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
