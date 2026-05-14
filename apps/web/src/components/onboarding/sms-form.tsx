'use client'

import { useState, useRef, useEffect } from 'react'
import { Send } from 'lucide-react'
import styles from './step-pair.module.css'
import onboardingStyles from './onboarding.module.css'

/**
 * HOR-161 — the SMS-fallback form on the desktop pair screen.
 *
 * Inline error/success rendering matches the step-notify.tsx pattern
 * (the codebase has no toast system yet — separate scope). 30s
 * cooldown is enforced client-side here as a UX guard; the server
 * has its own per-token cooldown (HOR-162) as the source of truth.
 */
interface Props {
  token: string
}

type Phase = 'idle' | 'sending' | 'sent' | 'error'

const COOLDOWN_SECONDS = 30

export function SMSForm({ token }: Props) {
  const [phone, setPhone] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [cooldownLeft, setCooldownLeft] = useState(0)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Tick down the cooldown each second.
  useEffect(() => {
    if (cooldownLeft <= 0) {
      if (cooldownRef.current) {
        clearInterval(cooldownRef.current)
        cooldownRef.current = null
      }
      return
    }
    if (!cooldownRef.current) {
      cooldownRef.current = setInterval(() => {
        setCooldownLeft((s) => Math.max(0, s - 1))
      }, 1000)
    }
    return () => {
      if (cooldownRef.current) {
        clearInterval(cooldownRef.current)
        cooldownRef.current = null
      }
    }
  }, [cooldownLeft])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (phase === 'sending' || cooldownLeft > 0) return

    setPhase('sending')
    setMessage(null)

    try {
      const res = await fetch('/api/onboarding/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, token }),
      })
      if (res.ok) {
        setPhase('sent')
        setMessage('Link sent. Check your phone.')
        setCooldownLeft(COOLDOWN_SECONDS)
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setPhase('error')
        setMessage(data.error ?? "Couldn't send. Try again or scan the QR.")
        // If server told us to back off with Retry-After, honour it.
        const retryAfter = Number(res.headers.get('Retry-After') ?? 0)
        if (retryAfter > 0) setCooldownLeft(retryAfter)
      }
    } catch {
      setPhase('error')
      setMessage("Couldn't send. Try again or scan the QR.")
    }
  }

  const disabled = phase === 'sending' || cooldownLeft > 0 || phone.trim().length < 6

  return (
    <form onSubmit={submit} className={styles.smsForm}>
      <label className={styles.smsLabel} htmlFor="pair-sms-phone">
        OR SEND A LINK
      </label>
      <div className={styles.smsRow}>
        <input
          id="pair-sms-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0412 345 678"
          className={styles.smsInput}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={phase === 'sending'}
        />
        <button
          type="submit"
          className={`${onboardingStyles.btn} ${onboardingStyles.btnSecondary}`}
          disabled={disabled}
        >
          <Send size={14} />
          {cooldownLeft > 0
            ? `Resend in ${cooldownLeft}s`
            : phase === 'sending'
              ? 'Sending…'
              : 'Text me the link'}
        </button>
      </div>
      {message && (
        <p
          className={
            phase === 'sent'
              ? styles.smsSuccess
              : phase === 'error'
                ? styles.smsError
                : styles.smsHint
          }
          role={phase === 'error' ? 'alert' : 'status'}
        >
          {message}
        </p>
      )}
    </form>
  )
}
