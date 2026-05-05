'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Eye, TrendingUp, Shield, ChevronDown } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import styles from './page.module.css'

const faqs = [
  {
    q: "How does Horace know who’s on my site?",
    a: "Horace matches website behaviour against your existing contacts. When a known contact visits without re-identifying themselves, Horace picks it up.",
  },
  {
    q: "Does it work with my current website?",
    a: "Yes. Horace adds a lightweight tracking layer to your existing site — no rebuild required.",
  },
  {
    q: "What does it cost?",
    a: (
      <>
        Pricing is per agent. <Link href="/contact">Get in touch</Link> and we&apos;ll walk you through the options.
      </>
    ),
  },
  {
    q: "Is my data private?",
    a: (
      <>
        Your visitor intelligence is yours. It&apos;s never sold, shared with other agents, or used to train models.{' '}
        <Link href="/data">Read our data commitment →</Link>
      </>
    ),
  },
  {
    q: "What if it’s quiet — no signals worth acting on?",
    a: (
      <>
        Horace tells you that too. <em>&ldquo;Nothing worth your attention yet&rdquo;</em> is still useful — you know someone&apos;s watching, so you don&apos;t have to.
      </>
    ),
  },
]

function FaqItem({ q, a }: { q: string; a: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const answerRef = useRef<HTMLDivElement>(null)

  return (
    <div className={`${styles.faqItem} ${open ? styles.faqOpen : ''}`}>
      <button
        className={styles.faqQuestion}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {q}
        <ChevronDown
          className={styles.faqChevron}
          size={18}
          strokeWidth={1.75}
          style={{ transition: 'transform 280ms cubic-bezier(0.16,1,0.3,1), color 180ms cubic-bezier(0.16,1,0.3,1)', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', color: open ? 'var(--color-terracotta)' : 'var(--color-stone)' }}
        />
      </button>
      <div
        ref={answerRef}
        className={styles.faqAnswer}
        style={{ maxHeight: open ? (answerRef.current?.scrollHeight ?? 400) + 'px' : '0' }}
      >
        <div className={styles.faqAnswerInner}>{a}</div>
      </div>
    </div>
  )
}

function RevealWrapper({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true)
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={`${styles.reveal} ${visible ? styles.visible : ''} ${className ?? ''}`}
    >
      {children}
    </div>
  )
}

export default function MarketingHomePage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoggedIn(!!session)
    })
  }, [])

  const ctaHref = isLoggedIn ? '/dashboard' : '/login'
  const ctaLabel = isLoggedIn ? 'Dashboard →' : 'Get started →'

  return (
    <div style={{ background: 'var(--color-parchment)', color: 'var(--color-ink)', minHeight: '100vh' }}>

      {/* ── NAV ── */}
      <nav className={styles.nav}>
        <div className={styles.navInner}>
          <Link href="/" className={styles.logoLockup}>
            <div className={styles.logoDot} />
            <span className={styles.wordmark}>Horace</span>
          </Link>
          <ul className={styles.navLinks}>
            <li><a href="#why">How it works</a></li>
            <li><a href="#faq">FAQ</a></li>
            <li><a href="#" style={{ color: 'var(--color-stone)' }}>Pricing</a></li>
          </ul>
          <Link href={ctaHref} className={`${styles.btn} ${styles.btnPrimary}`}>
            {isLoggedIn ? 'Dashboard' : 'Get started'}
          </Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section>
        <div className={styles.hero}>
          <div className={styles.heroContent}>
            <div className={styles.heroEyebrow}>Real estate intelligence</div>
            <h1>
              Your website already knows who<em> wants to sell.</em>
            </h1>
            <p className={styles.heroSub}>
              Horace reads the signals your visitors leave behind — and tells you before anyone else knows.
            </p>
            <div className={styles.heroActions}>
              <Link href={ctaHref} className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLg}`}>
                {ctaLabel}
              </Link>
              <a href="#why" className={`${styles.btn} ${styles.btnSecondary} ${styles.btnLg}`}>
                How it works
              </a>
            </div>
            <p className={styles.heroNote}>No rebuild required. Works with your existing website.</p>
          </div>

          {/* Signal preview mock */}
          <RevealWrapper className={styles.signalPreview}>
            <div className={styles.signalPreviewInner}>
              <div className={styles.previewHeader}>
                <span className={styles.previewTitle}>Today&apos;s signals</span>
                <span className={styles.previewBadge}>3 worth acting on</span>
              </div>

              <div className={styles.signalCardItem}>
                <div className={`${styles.signalDot} ${styles.dotHigh}`} />
                <div className={styles.scardBody}>
                  <div className={styles.scardTop}>
                    <span className={styles.scardName}>Sarah Thompson</span>
                    <span className={styles.scardTime}>2h ago</span>
                  </div>
                  <div className={styles.scardNudge}>
                    &ldquo;Back three times this week. Appraisal page viewed twice. Might be worth a call.&rdquo;
                  </div>
                  <div className={styles.scardTags}>
                    <span className={`${styles.tag} ${styles.tagHot}`}>High intent</span>
                    <span className={styles.tag}>Appraisal page</span>
                    <span className={styles.tag}>3 sessions</span>
                  </div>
                  <div className={styles.scardAction}>Call Sarah →</div>
                </div>
              </div>

              <div className={styles.signalCardItem}>
                <div className={`${styles.signalDot} ${styles.dotMid}`} />
                <div className={styles.scardBody}>
                  <div className={styles.scardTop}>
                    <span className={styles.scardName}>David Nguyen</span>
                    <span className={styles.scardTime}>Yesterday</span>
                  </div>
                  <div className={styles.scardNudge}>
                    &ldquo;Something&apos;s stirring on Maple Street. Browsing sold results — classic pre-appraisal.&rdquo;
                  </div>
                  <div className={styles.scardTags}>
                    <span className={styles.tag}>Mid intent</span>
                    <span className={styles.tag}>Sold results</span>
                    <span className={styles.tag}>Maple Street</span>
                  </div>
                </div>
              </div>

              <div className={styles.signalCardItem}>
                <div className={`${styles.signalDot} ${styles.dotLow}`} />
                <div className={styles.scardBody}>
                  <div className={styles.scardTop}>
                    <span className={styles.scardName}>Claire Adeyemi</span>
                    <span className={styles.scardTime}>3 days ago</span>
                  </div>
                  <div className={styles.scardNudge}>
                    &ldquo;Downloaded the suburb report. Still early — worth watching.&rdquo;
                  </div>
                  <div className={styles.scardTags}>
                    <span className={styles.tag}>Watching</span>
                    <span className={styles.tag}>Suburb report</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Floating nudge bubble */}
            <div className={styles.notifBubble}>
              <div className={styles.notifIcon}>
                <Image src="/horace-ink.png" alt="Horace" fill style={{ objectFit: 'cover' }} />
              </div>
              <div className={styles.notifTextBlock}>
                <div className={styles.notifLabel}>Horace</div>
                <div className={styles.notifBody}>&ldquo;Something&apos;s stirring on Maple Street.&rdquo;</div>
              </div>
            </div>
          </RevealWrapper>
        </div>
      </section>

      {/* ── WHY HORACE ── */}
      <section className={styles.whyStrip} id="why">
        <div className={styles.whyStripTop}>
          <div className={styles.sectionLabel}>Why Horace</div>
        </div>
        <RevealWrapper className={styles.whyGrid}>
          <div className={styles.whyCard}>
            <div className={styles.whyIcon}>
              <Eye size={28} strokeWidth={1.5} />
            </div>
            <div className={styles.whyTitle}>Know who&apos;s listing next</div>
            <p className={styles.whyBody}>
              Vendors research before they call. They browse sold results, revisit listings, read suburb reports — and never fill in a form. Horace reads that trail and tells you who&apos;s getting ready to move.
            </p>
          </div>
          <div className={styles.whyCard}>
            <div className={styles.whyIcon}>
              <TrendingUp size={28} strokeWidth={1.5} />
            </div>
            <div className={styles.whyTitle}>Win more listings</div>
            <p className={styles.whyBody}>
              The agent who knows first wins. A nudge from Horace before a vendor&apos;s called anyone gives you a conversation no one else is having.
            </p>
          </div>
          <div className={styles.whyCard}>
            <div className={styles.whyIcon}>
              <Shield size={28} strokeWidth={1.5} />
            </div>
            <div className={styles.whyTitle}>Own your prospect data</div>
            <p className={styles.whyBody}>
              Your intelligence lives outside any CRM. It&apos;s yours — not the platform&apos;s. If you move tools, it moves with you.
            </p>
          </div>
        </RevealWrapper>
        <div className={styles.whyStripBottom} />
      </section>

      {/* ── DIVIDER ── */}
      <div className={styles.divider} />

      {/* ── FAQ ── */}
      <section className={styles.faqSection} id="faq">
        <div className={styles.faqInner}>
          <div>
            <div className={styles.faqSideLabel}>Questions</div>
            <RevealWrapper>
              <div className={styles.faqSideHeading}>Common questions about Horace.</div>
            </RevealWrapper>
          </div>
          <div className={styles.faqList}>
            {faqs.map((faq) => (
              <FaqItem key={faq.q} q={faq.q} a={faq.a} />
            ))}
          </div>
        </div>
      </section>

      {/* ── DIVIDER ── */}
      <div className={styles.dividerFull} />

      {/* ── CTA ── */}
      <section className={styles.ctaSection}>
        <div className={styles.ctaInner}>
          <div>
            <h2 className={styles.ctaHeading}>Ready when you are.</h2>
            <p className={styles.ctaSub}>
              Horace is watching your street. Let&apos;s make sure you&apos;re the first to know.
            </p>
            <Link href={ctaHref} className={`${styles.btn} ${styles.btnCream} ${styles.btnLg}`}>
              {ctaLabel}
            </Link>
            <p className={styles.ctaSig}>Seize the moment — Horace</p>
          </div>
          <div className={styles.ctaCharacter}>
            <Image src="/horace-charcoal.png" alt="Horace" fill style={{ objectFit: 'cover' }} />
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <Link href="/" className={`${styles.logoLockup} ${styles.footerLogo}`}>
            <div className={styles.logoDot} />
            <span className={styles.wordmark}>Horace</span>
          </Link>
          <ul className={styles.footerLinks}>
            <li><a href="#">Privacy</a></li>
            <li><a href="#">Data</a></li>
            <li><a href="#">Contact</a></li>
          </ul>
          <span className={styles.footerSig}>Seize the moment — Horace</span>
        </div>
      </footer>

    </div>
  )
}
