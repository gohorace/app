'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { truncDomain } from '@/lib/audit/domain'
import { COPY } from '../copy'
import styles from '../audit.module.css'

const MARK = '/horace-charcoal.png'

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The loading narration. Five checks tick off in sequence at a scripted pace
 * (~46s realistic — matching the real audit's wall-clock — collapsed to ~2.6s
 * under reduced-motion). The real audit runs in parallel in the parent; this
 * component owns only the *narration* and calls `onNarrationDone` once the
 * scripted sequence + "almost done" has played. The parent gates the actual
 * hand-off to the report on both narration completing AND results arriving.
 */
export function LoadingState({
  domain,
  onNarrationDone,
}: {
  domain: string
  onNarrationDone: () => void
}) {
  const checks = COPY.loading.checks
  // 0 hidden, 1 shown/active, 2 complete
  const [status, setStatus] = useState<number[]>(() => checks.map(() => 0))
  const [almost, setAlmost] = useState(false)
  const [announce, setAnnounce] = useState('')
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const reduced = prefersReduced()
    const totalMs = reduced ? 2600 : 46000
    const totalW = checks.reduce((s, c) => s + c.weight, 0)
    let t = 0
    const push = (fn: () => void, at: number) => {
      timers.current.push(setTimeout(fn, at))
    }

    checks.forEach((c, i) => {
      const dur = (c.weight / totalW) * totalMs
      const startAt = t
      push(() => setStatus((p) => p.map((v, j) => (j === i ? 1 : v))), startAt)
      push(() => {
        setStatus((p) => p.map((v, j) => (j === i ? 2 : v)))
        setAnnounce(c.done)
      }, startAt + dur)
      t += dur
    })
    push(() => setAlmost(true), t + 60)
    push(() => onNarrationDone(), t + (reduced ? 350 : 850))

    const captured = timers.current
    return () => {
      captured.forEach(clearTimeout)
      timers.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={`${styles.hero} ${styles.fadeIn}`}>
      <Image className={styles.mark} src={MARK} alt="Horace" width={54} height={54} priority />
      <p className={styles.loadingLead}>
        {COPY.loading.lead} <span className={styles.dom}>{truncDomain(domain, 30)}</span>…
      </p>

      <div className={styles.checks}>
        {checks.map((c, i) => {
          const st = status[i]
          const cls = [
            styles.check,
            st >= 1 ? styles.shown : '',
            st === 1 ? styles.active : '',
            st === 2 ? styles.complete : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div className={cls} key={c.id}>
              <span className={styles.checkInd}>
                <span className={styles.dotPulse} />
                <Check className={styles.checkTick} aria-hidden="true" />
              </span>
              <span>{c.label}</span>
            </div>
          )
        })}
      </div>

      <p
        className={`${styles.almost} ${almost ? styles.shown : ''}`}
        aria-hidden={!almost}
      >
        {COPY.loading.final}
      </p>

      <div className={styles.srOnly} role="status" aria-live="polite">
        {announce}
      </div>
    </div>
  )
}
