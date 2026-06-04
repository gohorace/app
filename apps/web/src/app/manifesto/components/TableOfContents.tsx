import clsx from 'clsx'
import styles from '../manifesto.module.css'

export type TocEntry = { id: string; label: string }

type Props = {
  entries: TocEntry[]
  activeId: string | null
  onJump: (id: string) => void
}

export function TableOfContents({ entries, activeId, onJump }: Props) {
  return (
    <aside className={styles.toc} aria-label="Contents">
      <div className={styles.tocLabel}>The manifesto</div>
      <ul className={styles.tocList}>
        {entries.map((entry, i) => (
          <li key={entry.id}>
            <button
              type="button"
              className={clsx(styles.tocLink, activeId === entry.id && styles.active)}
              onClick={() => onJump(entry.id)}
            >
              <span className={styles.num}>{String(i + 1).padStart(2, '0')}</span>
              <span>{entry.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
