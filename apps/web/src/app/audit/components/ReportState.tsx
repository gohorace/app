'use client'

import Image from 'next/image'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link2 } from 'lucide-react'
import type { AuditResult } from '@/lib/audit/types'
import { truncDomain } from '@/lib/audit/domain'
import { COPY } from '../copy'
import { Finding } from './Finding'
import styles from '../audit.module.css'

const MARK = '/horace-charcoal.png'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function ReportState({ result }: { result: AuditResult }) {
  const r = COPY.report
  const { domain, findings, verdict, topThree, allGood, partial } = result

  const [confirmed, setConfirmed] = useState(false)
  const [email, setEmail] = useState('')
  const [hp, setHp] = useState('') // honeypot
  const [sending, setSending] = useState(false)
  const [emailErr, setEmailErr] = useState('')
  const [shared, setShared] = useState(false)
  const rootRef = useRef<HTMLElement>(null)

  // Trigger the staggered rise-in once mounted.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const els = root.querySelectorAll(`.${styles.rise}`)
    requestAnimationFrame(() => els.forEach((el) => el.classList.add(styles.in)))
  }, [])

  const submitEmail = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      setEmailErr(r.capture.emailErr)
      return
    }
    setEmailErr('')
    setSending(true)
    try {
      const res = await fetch('/api/site-audit/capture', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain, email: email.trim(), hp, result }),
      })
      if (!res.ok) throw new Error('send failed')
      setConfirmed(true)
    } catch {
      setEmailErr(r.capture.sendErr)
    } finally {
      setSending(false)
    }
  }

  const doShare = () => {
    const url = window.location.href.split('#')[0] + `#report-${domain}`
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(() => {})
    }
    setShared(true)
    setTimeout(() => setShared(false), 2200)
  }

  // Staggered entrance delays — 90ms apart, matching the handoff.
  let d = 0
  const step = () => {
    d += 90
    return d
  }
  const riseStyle = (delay: number) => ({ '--d': `${delay}ms` }) as CSSProperties

  const showTopThree = !allGood && topThree.length > 0

  return (
    <section className={styles.report} ref={rootRef}>
      <div className={styles.reportInner}>
        {/* opener */}
        <div className={`${styles.rOpener} ${styles.rise}`} style={riseStyle(0)}>
          <Image
            className={`${styles.mark} ${styles.markSm}`}
            src={MARK}
            alt="Horace"
            width={40}
            height={40}
          />
          <h1>
            I had a look at <span className={styles.dom}>{truncDomain(domain, 28)}</span>.
            <br />
            {r.openerLine}
          </h1>
          <p className={styles.rLede}>{allGood ? r.allGoodOpener : r.opener}</p>
          {!allGood && (
            <p className={styles.rVerdict}>
              <b>{verdict.solid}</b> of the five {verdict.solid === 1 ? 'is' : 'are'} solid.{' '}
              <b>{verdict.work}</b> could use some work. {r.verdictLine}
            </p>
          )}
          {partial && (
            <p className={styles.reassure} style={{ marginTop: 18 }}>
              {r.partialNote}
            </p>
          )}
        </div>

        <hr className={styles.sep} />

        {/* top 3 */}
        {showTopThree && (
          <>
            <div className={styles.rise} style={riseStyle(step())}>
              <div className={styles.top3Label}>{r.topThreeLabel}</div>
              <div className={styles.top3List}>
                {topThree.map((t, i) => (
                  <div className={styles.top3Item} key={i}>
                    <span className={styles.top3Num}>{String(i + 1).padStart(2, '0')}</span>
                    <p className={styles.top3Text}>{t}</p>
                  </div>
                ))}
              </div>
              <p className={styles.top3Foot}>{r.topThreeFooter}</p>
            </div>
            <hr className={styles.sep} />
          </>
        )}

        {/* findings */}
        <div className={styles.findings} id="findings">
          {findings.map((f) => (
            <Finding key={f.id} f={f} delay={step()} />
          ))}
        </div>

        <hr className={styles.sep} />

        {/* human eye */}
        <div className={styles.rise} style={riseStyle(step())}>
          <div className={styles.humaneyeLabel}>{r.humanEyeLabel}</div>
          <div className={styles.humaneyeList}>
            {r.humanEye.map((h, i) => (
              <div className={styles.humaneyeItem} key={i}>
                <span className={styles.em}>—</span>
                {h}
              </div>
            ))}
          </div>
          <p className={styles.humaneyeBody}>{r.humanEyeBody}</p>
        </div>

        <hr className={styles.sep} />

        {/* capture / confirmation */}
        {!confirmed ? (
          <div className={`${styles.capture} ${styles.rise}`} style={riseStyle(step())}>
            <p className={styles.capturePrompt}>{r.capture.prompt}</p>
            <div className={styles.captureForm}>
              <div style={{ flex: 1 }}>
                <label htmlFor="audit-email" className={styles.srOnly}>
                  Your email address
                </label>
                <input
                  id="audit-email"
                  className={styles.field}
                  type="email"
                  autoComplete="email"
                  placeholder={r.capture.placeholder}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (emailErr) setEmailErr('')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitEmail()
                  }}
                  onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
                />
              </div>
              {/* Honeypot — visually hidden, off the tab order. Bots fill it. */}
              <input
                type="text"
                name="company"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className={styles.srOnly}
                value={hp}
                onChange={(e) => setHp(e.target.value)}
              />
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => void submitEmail()}
                disabled={sending}
              >
                {sending ? 'Sending…' : r.capture.cta}
              </button>
            </div>
            <div
              className={`${styles.err} ${styles.captureErr}`}
              role="alert"
              style={{ marginTop: emailErr ? 10 : 0 }}
            >
              {emailErr}
            </div>
          </div>
        ) : (
          <div className={`${styles.confirm} ${styles.fadeIn}`}>
            <h2>{COPY.confirmation.headline}</h2>
            <p>{COPY.confirmation.secondary}</p>
            <div className={styles.confirmCtas}>
              <a
                className={`${styles.btn} ${styles.btnPrimary}`}
                href={COPY.confirmation.primary.href}
              >
                {COPY.confirmation.primary.label}
              </a>
              <a
                className={`${styles.btn} ${styles.btnGhost}`}
                href={COPY.confirmation.secondaryCta.href}
              >
                {COPY.confirmation.secondaryCta.label}
              </a>
            </div>
          </div>
        )}

        {/* footer */}
        <div className={styles.rFoot}>
          <button className={styles.shareBtn} onClick={doShare}>
            <Link2 aria-hidden="true" />
            {shared ? r.share.done : r.share.idle}
          </button>
          <p className={styles.signature}>{r.signature}</p>
        </div>
      </div>
    </section>
  )
}
