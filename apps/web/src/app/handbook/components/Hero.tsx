import { Play } from 'lucide-react'
import { hero } from '../content'
import styles from '../handbook.module.css'

export function Hero({ readTime, onListen }: { readTime: string; onListen: () => void }) {
  return (
    <section className={styles.hero} id="hero">
      <div className={styles.eyebrow}>{hero.eyebrow}</div>
      <h1 data-speak="">
        {hero.titleLead}
        <br />
        <em>{hero.titleEm}</em>
        {hero.titleTail}
      </h1>
      <p className={styles.standfirst} data-speak="">
        {hero.standfirst}
      </p>
      <div className={styles.byline}>
        <div className={styles.bylineAv}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/horace-ink.png" alt="Horace" width={54} height={54} />
        </div>
        <div className={styles.bylineMeta}>
          <div className={styles.bylineBy}>
            {hero.bylineBy} <span>{hero.bylineByTail}</span>
          </div>
          <div className={styles.bylineSub}>
            <span>{readTime}</span>
            <span className={styles.dot} />
            <span>{hero.bylineKind}</span>
          </div>
        </div>
        <button type="button" className={styles.bylineListen} onClick={onListen}>
          <Play fill="currentColor" />
          Listen to this
        </button>
      </div>
    </section>
  )
}
