import Link from 'next/link'
import styles from './marketing.module.css'

export function MarketingFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <Link href="/" className={`${styles.logoLockup} ${styles.footerLogo}`}>
          <div className={styles.logoDot} />
          <span className={styles.wordmark}>Horace</span>
        </Link>
        <ul className={styles.footerLinks}>
          <li><Link href="/pricing">Pricing</Link></li>
          <li><Link href="/privacy">Privacy</Link></li>
          <li><Link href="/data">Data</Link></li>
          <li><a href="mailto:hello@horace.com">Contact</a></li>
        </ul>
        <span className={styles.footerSig}>Seize the moment — Horace</span>
      </div>
    </footer>
  )
}
