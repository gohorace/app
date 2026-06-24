import clsx from 'clsx'
import { Pause, Play, SkipBack, SkipForward, Square } from 'lucide-react'
import styles from '../manifesto.module.css'

type Props = {
  show: boolean
  isPlaying: boolean
  status: string
  progress: number
  onToggle: () => void
  onStop: () => void
  onNext: () => void
  onPrev: () => void
}

export function NowPlayingBar({
  show,
  isPlaying,
  status,
  progress,
  onToggle,
  onStop,
  onNext,
  onPrev,
}: Props) {
  return (
    <div className={clsx(styles.player, show && styles.show)} aria-hidden={!show}>
      <div className={styles.playerAv}>
        {/* plain <img>, not next/image: this avatar lives in a fixed bar that
            starts transformed off-screen, where next/image's lazy-load never
            fires. It's a 38px static brand PNG — optimization buys nothing. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/horace-ink.png" alt="Horace" width={38} height={38} />
      </div>
      <div className={styles.playerInfo}>
        <div className={styles.pt}>Listening to the manifesto</div>
        <div className={styles.ps}>{status}</div>
        <div className={styles.playerProg}>
          <i style={{ width: `${progress.toFixed(1)}%` }} />
        </div>
      </div>
      <div className={styles.playerCtrl}>
        <button type="button" className={styles.pbtn} onClick={onPrev} title="Back">
          <SkipBack fill="currentColor" />
        </button>
        <button
          type="button"
          className={clsx(styles.pbtn, styles.main)}
          onClick={onToggle}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        </button>
        <button type="button" className={styles.pbtn} onClick={onNext} title="Skip">
          <SkipForward fill="currentColor" />
        </button>
        <button type="button" className={styles.pbtn} onClick={onStop} title="Stop">
          <Square fill="currentColor" />
        </button>
      </div>
    </div>
  )
}
