import clsx from 'clsx'
import { Bookmark, Pause, Play, Share2, Smartphone } from 'lucide-react'
import styles from '../handbook.module.css'

type Props = {
  scrolled: boolean
  saved: boolean
  onSave: () => void
  onPhone: () => void
  onShare: () => void
  isPlaying: boolean
  listenLabel: string
  listenSupported: boolean
  onListen: () => void
  onBrand: () => void
}

export function Topbar({
  scrolled,
  saved,
  onSave,
  onPhone,
  onShare,
  isPlaying,
  listenLabel,
  listenSupported,
  onListen,
  onBrand,
}: Props) {
  return (
    <header className={clsx(styles.topbar, scrolled && styles.scrolled)}>
      <button type="button" className={styles.brand} onClick={onBrand} aria-label="Horace — top">
        <span className={styles.brandDot} />
        <span className={styles.brandName}>Horace</span>
        <span className={styles.brandSep} />
        <span className={styles.brandTag}>The handbook</span>
      </button>
      <nav className={styles.tools}>
        <button
          type="button"
          className={clsx(styles.toolBtn, saved && styles.active)}
          onClick={onSave}
          title="Save to read later"
          aria-pressed={saved}
        >
          <Bookmark fill={saved ? 'currentColor' : 'none'} />
          <span className={styles.lbl}>Save</span>
        </button>
        <button type="button" className={styles.toolBtn} onClick={onPhone} title="Send to your phone">
          <Smartphone />
          <span className={styles.lbl}>To phone</span>
        </button>
        <button type="button" className={styles.toolBtn} onClick={onShare} title="Share with a colleague">
          <Share2 />
          <span className={styles.lbl}>Share</span>
        </button>
        <button
          type="button"
          className={clsx(styles.toolBtn, styles.primaryListen)}
          onClick={onListen}
          title="Listen to this"
          style={listenSupported ? undefined : { opacity: 0.5 }}
        >
          {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
          <span className={styles.lbl}>{listenLabel}</span>
        </button>
      </nav>
    </header>
  )
}
