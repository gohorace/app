'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Sparkles } from 'lucide-react'
import styles from './onboarding.module.css'
import revealStyles from './step-reveal.module.css'

interface Props {
  firstName: string | null
  onFinish: () => void
}

interface SampleSignal {
  name: string
  initials: string
  intent: 'high' | 'mid' | 'low'
  intentLabel: string
  nudge: string
  meta: string
}

const SAMPLES: SampleSignal[] = [
  {
    name: 'Sarah Thompson',
    initials: 'ST',
    intent: 'high',
    intentLabel: 'High intent',
    nudge: '“Sarah’s back three times this week. Appraisal page, twice. Worth a call.”',
    meta: '2h ago · Sample',
  },
  {
    name: 'David Nguyen',
    initials: 'DN',
    intent: 'mid',
    intentLabel: 'Mid intent',
    nudge: '“Something’s stirring on Maple Street. Browsing sold results — classic pre-appraisal.”',
    meta: 'Yesterday · Sample',
  },
  {
    name: 'Claire Adeyemi',
    initials: 'CA',
    intent: 'low',
    intentLabel: 'Watching',
    nudge: '“Downloaded the suburb report. Still early — worth keeping an eye on.”',
    meta: '3 days ago · Sample',
  },
]

export function StepReveal({ firstName, onFinish }: Props) {
  const [hasFirstSignal, setHasFirstSignal] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const res = await fetch('/api/onboarding/verify-snippet', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data.verified) {
          setHasFirstSignal(true)
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch {
        // ignore transient errors
      }
    }
    check()
    pollRef.current = setInterval(check, 5000)
    return () => {
      cancelled = true
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const greeting = firstName
    ? `${firstName}, you’re live.`
    : 'You’re live.'

  return (
    <div className={styles.stepFade}>
      <div className={revealStyles.heroRow}>
        <div className={revealStyles.heroAvatar}>
          <Image src="/horace-charcoal.png" alt="Horace" fill style={{ objectFit: 'contain' }} />
        </div>
        <div>
          <div className={revealStyles.greeting}>{greeting}</div>
          <p className={revealStyles.greetingSub}>
            {hasFirstSignal
              ? 'Your first real visit just landed. The dashboard is now showing live activity.'
              : 'Sample signals below show what Horace looks like when it’s humming. The first real visit lights up the moment it lands.'}
          </p>
        </div>
      </div>

      {hasFirstSignal && (
        <div className={revealStyles.firstSignalBanner}>
          <Sparkles size={16} />
          <span>First signal received — Horace is listening on your site.</span>
        </div>
      )}

      <div className={revealStyles.dashboardMock}>
        <div className={revealStyles.mockHeader}>
          <span className={revealStyles.mockHeaderTitle}>Today’s signals</span>
          <span className={revealStyles.mockHeaderBadge}>
            {hasFirstSignal ? '1 live · 3 sample' : '3 sample'}
          </span>
        </div>
        <div className={revealStyles.mockList}>
          {SAMPLES.map((s) => (
            <div key={s.name} className={revealStyles.signalRow}>
              <div className={`${revealStyles.avatar} ${revealStyles[`avatar_${s.intent}`]}`}>
                {s.initials}
              </div>
              <div className={revealStyles.signalBody}>
                <div className={revealStyles.signalTop}>
                  <span className={revealStyles.signalName}>{s.name}</span>
                  <span className={revealStyles.signalMeta}>{s.meta}</span>
                </div>
                <div className={revealStyles.signalNudge}>{s.nudge}</div>
                <span className={`${revealStyles.tag} ${revealStyles[`tag_${s.intent}`]}`}>
                  {s.intentLabel}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.paneActions}>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--color-stone-aa)' }}>
          Seize the moment — Horace
        </span>
        <div className={styles.paneActionsRight}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={onFinish} type="button">
            {hasFirstSignal ? 'Open my dashboard' : 'Take me to my dashboard'} <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
