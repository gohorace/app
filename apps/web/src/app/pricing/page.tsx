'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { MarketingNav } from '@/components/marketing/MarketingNav'
import { MarketingFooter } from '@/components/marketing/MarketingFooter'
import { createClient } from '@/lib/supabase/client'
import styles from './page.module.css'
import navStyles from '@/components/marketing/marketing.module.css'

type Period = 'monthly' | 'annual'

const tiers = [
  {
    name: 'Pro',
    tag: 'The full picture.',
    badge: 'Most popular',
    price: { monthly: '$149', annual: '$125' },
    unit: { monthly: '/month', annual: '/month' },
    note: { monthly: 'Billed monthly', annual: '$1500 billed annually — save $288' },
    subPrice: {
      monthly: 'Support seats $39/mo · unlimited',
      annual: 'Support seats $39/mo · unlimited',
    },
    cta: 'Start free trial',
    ctaHref: '/login',
    plan: 'pro' as const,
    includesLabel: "What's included",
    features: [
      'Lead identification — know when a contact returns',
      'Real-time nudges, not just weekly',
      '12 months of signal history',
      'Your website + Doorstep',
      'Support seats for your admin or PA',
    ],
    goodFor: 'Solo agents who want every signal that matters.',
    featured: true,
  },
  {
    name: 'Office',
    tag: 'For teams working the same patch.',
    price: { monthly: '$119', annual: '$99' },
    unit: { monthly: '/mo', annual: '/mo' },
    note: { monthly: 'per agent · 3 agents min', annual: 'per agent · billed annually' },
    subPrice: {
      monthly: 'Support seats $39/mo · unlimited',
      annual: 'Support seats $39/mo · unlimited',
    },
    cta: 'Coming soon',
    ctaHref: '#',
    comingSoon: true as const,
    includesLabel: 'Everything in Pro, plus',
    features: [
      'Multiple websites',
      'Shared intelligence across the team',
      'Lead routing between agents',
      'Getting started support',
    ],
    goodFor: 'Offices of 3 to 9 agents.',
    featured: false,
  },
  {
    name: 'Enterprise',
    tag: 'For franchises and larger groups.',
    price: { monthly: 'Custom', annual: 'Custom' },
    unit: { monthly: '', annual: '' },
    note: { monthly: '10+ agents · custom terms', annual: '10+ agents · custom terms' },
    cta: 'Talk to us',
    ctaHref: 'mailto:team@gohorace.com',
    includesLabel: 'Everything in Office, plus',
    features: [
      'Custom contract terms',
      'Dedicated support contact',
      'Setup tailored to your group',
      'SSO & security review',
    ],
    goodFor: 'Franchises and larger groups.',
    featured: false,
  },
]

export default function PricingPage() {
  const [period, setPeriod] = useState<Period>('monthly')
  const [pillStyle, setPillStyle] = useState<{ width: number; transform: string }>({ width: 0, transform: '' })
  const toggleRef = useRef<HTMLDivElement>(null)
  const monthlyBtnRef = useRef<HTMLButtonElement>(null)
  const annualBtnRef = useRef<HTMLButtonElement>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => setIsLoggedIn(!!session))
  }, [])

  const ctaHref = isLoggedIn ? '/dashboard' : '/login'

  function repositionPill(activePeriod: Period = period) {
    const btn = activePeriod === 'monthly' ? monthlyBtnRef.current : annualBtnRef.current
    const parent = toggleRef.current
    if (!btn || !parent) return
    const btnRect = btn.getBoundingClientRect()
    const parentRect = parent.getBoundingClientRect()
    setPillStyle({
      width: btnRect.width,
      transform: `translateX(${btnRect.left - parentRect.left - 5}px)`,
    })
  }

  useEffect(() => {
    repositionPill()
    window.addEventListener('resize', () => repositionPill())
    return () => window.removeEventListener('resize', () => repositionPill())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  function handlePeriod(p: Period) {
    setPeriod(p)
    repositionPill(p)
  }

  const [trialLoading, setTrialLoading] = useState(false)

  async function startTrial(plan: 'pro', overridePeriod?: Period) {
    const targetPeriod = overridePeriod ?? period
    if (!isLoggedIn) {
      const redirectTo = `/pricing?plan=${plan}&period=${targetPeriod}`
      window.location.href = `/signup?redirectTo=${encodeURIComponent(redirectTo)}`
      return
    }
    setTrialLoading(true)
    try {
      const res = await fetch('/api/billing/start-trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: `${plan}_${targetPeriod === 'annual' ? 'annual' : 'monthly'}` }),
      })
      const data = await res.json()
      if (!res.ok) {
        // Already-active subscription is fine — just send them to dashboard
        if (res.status === 409) {
          window.location.href = '/dashboard?billing=already-active'
          return
        }
        console.error('Start trial failed:', data)
        alert(data.error ?? 'Could not start trial')
        setTrialLoading(false)
        return
      }
      window.location.href = '/dashboard?billing=trial-started'
    } catch (err) {
      console.error(err)
      setTrialLoading(false)
    }
  }

  // Auto-start trial when arriving with ?plan=pro intent (post-signup/login)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const planParam = params.get('plan')
    const periodParam = params.get('period') as Period | null
    if (isLoggedIn && planParam === 'pro' && !trialLoading) {
      startTrial('pro', periodParam === 'annual' ? 'annual' : 'monthly')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn])

  return (
    <div className={styles.page}>
      <MarketingNav />

      <main>
        {/* HERO */}
        <header className={styles.hero}>
          <div className={styles.eyebrow}>Pricing</div>
          <h1>Simple. Honest. <em>No lock-in.</em></h1>
          <p className={styles.lede}>Start with a 14-day trial. Upgrade when Horace earns it.</p>

          <div className={styles.billingToggle} ref={toggleRef}>
            <span
              className={styles.togglePill}
              style={{ width: pillStyle.width, transform: pillStyle.transform }}
            />
            <button
              ref={monthlyBtnRef}
              className={`${styles.toggleBtn} ${period === 'monthly' ? styles.active : ''}`}
              onClick={() => handlePeriod('monthly')}
            >
              Monthly
            </button>
            <button
              ref={annualBtnRef}
              className={`${styles.toggleBtn} ${period === 'annual' ? styles.active : ''}`}
              onClick={() => handlePeriod('annual')}
            >
              Annual
              <span className={styles.saveTag}>Save 17%</span>
            </button>
          </div>
        </header>

        {/* PRICING GRID */}
        <section className={styles.gridWrap}>
          <div className={styles.grid}>
            {tiers.map((tier) => (
              <div key={tier.name} className={`${styles.tier} ${tier.featured ? styles.tierFeatured : ''}`}>
                {tier.badge && <div className={styles.tierBadge}>{tier.badge}</div>}
                <div className={styles.tierName}>{tier.name}</div>
                <div className={styles.tierTag}>{tier.tag}</div>
                <div className={styles.tierPrice}>
                  <span className={`${styles.amount} ${tier.price.monthly === 'Custom' ? styles.amountText : ''}`}>
                    {tier.price[period]}
                  </span>
                  {tier.unit[period] && <span className={styles.unit}>{tier.unit[period]}</span>}
                </div>
                <div className={styles.priceMeta}>
                  <div className={styles.priceNote}>{tier.note[period]}</div>
                  {'subPrice' in tier && tier.subPrice && (
                    <div className={styles.priceSubLine}>{tier.subPrice[period]}</div>
                  )}
                </div>
                {'plan' in tier && tier.plan === 'pro' ? (
                  <button
                    type="button"
                    className={styles.tierCta}
                    disabled={trialLoading}
                    onClick={() => startTrial('pro')}
                  >
                    {trialLoading ? 'Loading…' : tier.cta}
                  </button>
                ) : 'comingSoon' in tier && tier.comingSoon ? (
                  <span
                    className={styles.tierCta}
                    aria-disabled="true"
                    style={{ cursor: 'not-allowed', opacity: 0.55 }}
                  >
                    {tier.cta}
                  </span>
                ) : (
                  <a href={tier.ctaHref} className={styles.tierCta}>{tier.cta}</a>
                )}
                <div className={styles.includesLabel}>{tier.includesLabel}</div>
                <ul className={styles.features}>
                  {tier.features.map((f) => (
                    <li key={f}>
                      <Check size={14} strokeWidth={2.25} className={styles.featureIcon} />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className={styles.goodFor}>{tier.goodFor}</div>
              </div>
            ))}
          </div>
        </section>

        {/* COMPARE TABLE */}
        <section className={styles.compareSection}>
          <h2 className={styles.compareHeading}>Compare plans</h2>
          <table className={styles.compareTable}>
            <thead>
              <tr>
                <th></th>
                <th className={`${styles.center} ${styles.featuredCol}`}>Pro</th>
                <th className={styles.center}>Office</th>
                <th className={styles.center}>Enterprise</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Visitor behaviour signals',  '●','●','●'],
                ['Property interest tracking', '●','●','●'],
                ['Weekly digest',              '●','●','●'],
                ['Lead identification',        '●','●','●'],
                ['Real-time nudges',           '●','●','●'],
                ['Doorstep',                   '●','●','●'],
                ['Signal history',             '12 months','12 months','Custom'],
                ['Websites',                   '1','Multiple','Multiple'],
                ['Shared team intelligence',   '–','●','●'],
                ['Lead routing',               '–','●','●'],
                ['Onboarding support',         'Self-serve','Guided','Dedicated'],
                ['Support seats',              '$39/mo each','$39/mo each','$39/mo each'],
                ['SSO & security review',      '–','–','●'],
              ].map(([label, pro, office, enterprise]) => (
                <tr key={label as string}>
                  <td>{label}</td>
                  {[pro, office, enterprise].map((val, i) => (
                    <td key={i} className={styles.center}>
                      {val === '●' ? <span className={styles.check}>●</span>
                       : val === '–' ? <span className={styles.dash}>—</span>
                       : <span style={{ color: ['Self-serve','1'].includes(val as string) ? 'var(--color-stone)' : 'var(--color-ink)', fontWeight: ['Self-serve','1'].includes(val as string) ? 400 : 500 }}>{val}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* WORTH KNOWING */}
        <section className={styles.worthKnowing}>
          <div className={styles.worthInner}>
            <div>
              <div className={styles.worthSideLabel}>A few things</div>
              <div className={styles.worthSideHeading}>Worth knowing before you start.</div>
            </div>
            <div className={styles.worthList}>
              <div>
                <div className={styles.worthItemTitle}>Your data is yours.</div>
                <div className={styles.worthItemBody}>Always. We never sell it, share it with other agents, or use it to train models. <Link href="/data">Read the detail →</Link></div>
              </div>
              <div>
                <div className={styles.worthItemTitle}>No lock-in.</div>
                <div className={styles.worthItemBody}>Cancel anytime. Take your intelligence with you when you go.</div>
              </div>
              <div>
                <div className={styles.worthItemTitle}>Free trial on Pro.</div>
                <div className={styles.worthItemBody}>14 days. No card needed. Add a card before day 14 to keep going — no card, no charge, your trial just ends. Your data is preserved either way.</div>
              </div>
              <div>
                <div className={styles.worthItemTitle}>Support seats.</div>
                <div className={styles.worthItemBody}>For admins, PAs, and sales support. They see your signals and can action them — they don&apos;t have their own pipeline. Available on every plan. On Office, support seats don&apos;t count toward the 3-agent minimum.</div>
              </div>
              <div>
                <div className={styles.worthItemTitle}>Pricing in AUD.</div>
                <div className={styles.worthItemBody}>All prices include GST. Billed in Australian dollars.</div>
              </div>
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className={styles.finalCta}>
          <div className={styles.finalCtaInner}>
            <h2>Ready when you are.</h2>
            <p>Start with a 14-day trial. Upgrade when Horace earns it.</p>
            <Link href={ctaHref} className={`${navStyles.btn} ${navStyles.btnCream} ${navStyles.btnLg}`}>
              Get started →
            </Link>
            <p className={styles.sig}>Seize the moment — Horace</p>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
