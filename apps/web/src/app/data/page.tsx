import type { Metadata } from 'next'
import { MarketingNav } from '@/components/marketing/MarketingNav'
import { MarketingFooter } from '@/components/marketing/MarketingFooter'
import styles from '../prose.module.css'

export const metadata: Metadata = {
  title: 'Your data — Horace',
  description: 'How Horace handles your data. Full stop.',
}

export default function DataPage() {
  return (
    <div className={styles.page}>
      <MarketingNav />

      <main>
        <header className={styles.hero}>
          <div className={styles.eyebrow}>Your data</div>
          <h1>Your data. Full stop.</h1>
        </header>

        <article className={styles.body}>
          <p>Horace works for you — not the platform, not advertisers, not anyone else.</p>
          <p>Everything Horace learns about your prospects, your visitors, and your market belongs to you. Here&apos;s exactly how that works.</p>

          <ul className={styles.commitmentList}>
            <li>
              <span className={styles.commitmentTitle}>We never sell your data.</span>
              <span className={styles.commitmentBody}>The behavioural intelligence Horace builds is yours. It&apos;s never sold, shared, or traded — to anyone, for any reason.</span>
            </li>
            <li>
              <span className={styles.commitmentTitle}>We never share it with other agents.</span>
              <span className={styles.commitmentBody}>Your visitor intelligence is invisible to every other agent on the platform. What Horace knows about your market stays with you.</span>
            </li>
            <li>
              <span className={styles.commitmentTitle}>We never use it to train models.</span>
              <span className={styles.commitmentBody}>Your clients&apos; behaviour doesn&apos;t feed our product or anyone else&apos;s. It informs your work only.</span>
            </li>
            <li>
              <span className={styles.commitmentTitle}>You own it when you leave.</span>
              <span className={styles.commitmentBody}>If you move to a different tool or platform, your data comes with you. It doesn&apos;t stay behind, and it doesn&apos;t disappear.</span>
            </li>
            <li>
              <span className={styles.commitmentTitle}>It lives outside your CRM by design.</span>
              <span className={styles.commitmentBody}>Horace stores your intelligence as a sovereign layer — separate from any CRM. That means it can&apos;t be held hostage by a platform you might one day outgrow.</span>
            </li>
            <li>
              <span className={styles.commitmentTitle}>It&apos;s stored in Australia.</span>
              <span className={styles.commitmentBody}>Your data is hosted on Australian servers and handled under Australian privacy law.</span>
            </li>
          </ul>

          <p className={styles.dataContact}>
            Any questions about how your data is handled? Ask us directly —{' '}
            <a href="mailto:hello@horace.com">hello@horace.com</a>
          </p>

          <p className={styles.sig}>Seize the moment — Horace</p>
        </article>
      </main>

      <MarketingFooter />
    </div>
  )
}
