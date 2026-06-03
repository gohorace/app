import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { closing } from '../content'
import styles from '../handbook.module.css'

export function Closing() {
  return (
    <section className={styles.closing} id="close">
      <div className={styles.closingInner}>
        <div className={styles.closingChar}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/horace-charcoal.png" alt="Horace" width={84} height={84} />
        </div>
        <div className={styles.eyebrow}>{closing.eyebrow}</div>
        <p className={styles.lede} data-speak="">
          {closing.lede}
        </p>
        <p className={styles.sub} data-speak="">
          {closing.sub}
        </p>
        <p className={styles.sig} data-speak="">
          {closing.sigLine1}
          <br />
          {closing.sigLine2}
        </p>
        <div className={styles.ctaRow}>
          <Link className={`${styles.cta} ${styles.ctaPrimary}`} href={closing.ctaPrimary.href}>
            {closing.ctaPrimary.label}
            <ArrowRight />
          </Link>
          <a
            className={`${styles.cta} ${styles.ctaGhost}`}
            href={closing.ctaGhost.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {closing.ctaGhost.label}
          </a>
        </div>
        <p className={styles.closingTrial}>{closing.trial}</p>
      </div>
    </section>
  )
}
