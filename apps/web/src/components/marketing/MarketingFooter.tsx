import Link from 'next/link'
import styles from './marketing.module.css'

const COLUMNS = [
  {
    label: 'Product',
    links: [
      { href: '/pricing', label: 'Pricing' },
      { href: '/signup', label: 'Get started' },
      { href: '/login', label: 'Login' },
    ],
  },
  {
    label: 'Reading',
    links: [
      { href: '/manifesto', label: 'Manifesto' },
      { href: '/audit', label: 'Audit' },
      { href: '/playbook', label: 'Playbook' },
    ],
  },
  {
    label: 'Company',
    links: [
      { href: '/privacy', label: 'Privacy' },
      { href: '/data', label: 'Data' },
      { href: '/contact', label: 'Contact' },
    ],
  },
]

export function MarketingFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerBrand}>
          <Link href="/" className={`${styles.logoLockup} ${styles.footerLogo}`}>
            <div className={styles.logoDot} />
            <span className={styles.wordmark}>Horace</span>
          </Link>
          <p className={styles.footerSig}>Seize the moment — Horace</p>
        </div>
        <nav className={styles.footerCols}>
          {COLUMNS.map((col) => (
            <div key={col.label} className={styles.footerCol}>
              <span className={styles.footerColLabel}>{col.label}</span>
              <ul>
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className={styles.footerBaseline}>
        <span>© {new Date().getFullYear()} Horace</span>
        <span>Made for people who&rsquo;d rather be doing the work.</span>
      </div>
    </footer>
  )
}
