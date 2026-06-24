import clsx from 'clsx'
import type { Chapter as ChapterData } from '../content'
import styles from '../manifesto.module.css'
import { renderInline } from './inline'

export function Chapter({ chapter, num }: { chapter: ChapterData; num: string | null }) {
  return (
    <article className={styles.chapter} id={chapter.id}>
      {chapter.tagLabel && (
        <div className={styles.chapterTag}>
          {num && <span className={styles.num}>{num}</span>} {chapter.tagLabel}
          <span className={styles.rule} />
        </div>
      )}
      {chapter.heading && <h2 data-speak="">{chapter.heading}</h2>}
      {chapter.paras.map((p, i) => (
        <p
          key={i}
          data-speak=""
          className={clsx(
            i === 0 && chapter.lead && styles.lead,
            i === 0 && chapter.dropcap && styles.dropcap,
          )}
        >
          {renderInline(p)}
        </p>
      ))}
    </article>
  )
}
