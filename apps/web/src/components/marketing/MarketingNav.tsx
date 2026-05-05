'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import styles from './marketing.module.css'

export function MarketingNav() {
  const pathname = usePathname()
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoggedIn(!!session)
    })
  }, [])

  const ctaHref = isLoggedIn ? '/dashboard' : '/login'
  const ctaLabel = isLoggedIn ? 'Dashboard' : 'Get started'

  return (
    <nav className={styles.nav}>
      <div className={styles.navInner}>
        <Link href="/" className={styles.logoLockup}>
          <div className={styles.logoDot} />
          <span className={styles.wordmark}>Horace</span>
        </Link>
        <ul className={styles.navLinks}>
          <li>
            <Link href="/#why" className={pathname === '/' ? styles.active : ''}>
              How it works
            </Link>
          </li>
          <li>
            <Link href="/pricing" className={pathname === '/pricing' ? styles.active : ''}>
              Pricing
            </Link>
          </li>
          <li>
            <Link href="/data" className={pathname === '/data' ? styles.active : ''}>
              Your data
            </Link>
          </li>
        </ul>
        <Link href={ctaHref} className={`${styles.btn} ${styles.btnPrimary}`}>
          {ctaLabel}
        </Link>
      </div>
    </nav>
  )
}
