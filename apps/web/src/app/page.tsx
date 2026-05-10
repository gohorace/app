'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Eye, TrendingUp, Shield, ChevronDown } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { MarketingNav } from '@/components/marketing/MarketingNav'
import { MarketingFooter } from '@/components/marketing/MarketingFooter'
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

  const ctaHref = isLoggedIn ? '/dashboard' : '/signup'
  const ctaLabel = isLoggedIn ? 'Dashboard →' : 'Start free 14-day trial →'

  return (
    <div style={{ background: 'var(--color-parchment)', color: 'var(--color-ink)', minHeight: '100vh' }}>

      <MarketingNav />

      {/* ── HERO ── */}
      <section>
        <div className={styles.hero}>
          <div className={styles.heroContent}>
            <div className={styles.heroEyebrow}>For real estate agents</div>
            <h1>
              See who&apos;s <em>really</em> looking,<br />before they call.
            </h1>
            <p className={styles.heroSub}>
              Horace reads the trail vendors leave on your website and tells you who&apos;s worth a call — and when. Set up takes about three minutes. Your first signals appear today.
            </p>
            <div className={styles.heroActions}>
              <Link href={ctaHref} className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLg}`}>
                {ctaLabel}
              </Link>
              {!isLoggedIn && (
                <Link href="/login" className={styles.heroSignIn}>
                  Sign in
                </Link>
              )}
            </div>
            <p className={styles.heroNote}>Pro on us for 14 days. No card required.</p>
            <div className={styles.heroTrust}>
              <span>Your data stays yours</span>
              <span className={styles.heroTrustDot} aria-hidden />
              <span>Built in Australia</span>
            </div>
          </div>

          {/* Trial card */}
          <RevealWrapper className={styles.trialCard}>
            <div className={styles.trialCardInner}>
              <div className={styles.trialCharacterRow}>
                <div className={styles.trialCharacterImg}>
                  <Image src="/horace-charcoal.png" alt="Horace" fill style={{ objectFit: 'contain' }} />
                </div>
                <div>
                  <div className={styles.trialCharacterName}>Horace</div>
                  <div className={styles.trialCharacterRole}>Your market, always watching</div>
                </div>
              </div>
              <div className={styles.trialQuote}>
                &ldquo;Sarah&apos;s been back three times this week. Appraisal page, twice. Might be worth a call.&rdquo;
              </div>
              <div className={styles.trialStats}>
                <div className={styles.trialStat}>
                  <div className={styles.trialStatVal}>3.2&times;</div>
                  <div className={styles.trialStatLabel}>faster to first call</div>
                </div>
                <div className={styles.trialStat}>
                  <div className={styles.trialStatVal}>41%</div>
                  <div className={styles.trialStatLabel}>more appraisals booked</div>
                </div>
                <div className={styles.trialStat}>
                  <div className={styles.trialStatVal}>~3min</div>
                  <div className={styles.trialStatLabel}>to set up</div>
                </div>
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
            <Image src="/horace-mark-512.png" alt="Horace" fill style={{ objectFit: 'contain' }} />
          </div>
        </div>
      </section>

      <MarketingFooter />

    </div>
  )
}
