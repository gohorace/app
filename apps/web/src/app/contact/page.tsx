import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { MarketingNav } from '@/components/marketing/MarketingNav'
import { MarketingFooter } from '@/components/marketing/MarketingFooter'
import { isDoorstepHost } from '@/lib/doorstep/host'
import { DoorstepContact } from '@/components/doorstep/neutral-legal'
import styles from '../prose.module.css'

// HOR-282: host-aware, like /privacy. The neutral Doorstep host gets a
// brand-free contact page; the marketing host gets the Horace one (which
// also fixes the pre-existing broken "Get in touch" link on the landing
// page — app/page.tsx linked /contact but no route existed).
export function generateMetadata(): Metadata {
  if (isDoorstepHost(headers().get('host'))) {
    return { title: 'Contact', description: 'How to reach Doorstep.' }
  }
  return { title: 'Contact — Horace', description: 'Get in touch with the Horace team.' }
}

export default function ContactPage() {
  if (isDoorstepHost(headers().get('host'))) {
    return <DoorstepContact />
  }
  return (
    <div className={styles.page}>
      <MarketingNav />

      <main>
        <header className={styles.hero}>
          <div className={styles.eyebrow}>Contact</div>
          <h1>Get in touch.</h1>
        </header>

        <article className={styles.body}>
          <p>
            Questions about Horace, pricing, or your account? Email{' '}
            <a href="mailto:team@gohorace.com">
              <strong>team@gohorace.com</strong>
            </a>{' '}
            and we&apos;ll get back to you.
          </p>
          <p className={styles.sig}>Seize the moment — Horace</p>
        </article>
      </main>

      <MarketingFooter />
    </div>
  )
}
