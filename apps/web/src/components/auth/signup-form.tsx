'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Mail, Phone, Shield, CheckCircle2, ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import styles from './signup-form.module.css'

export function SignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectTo') ?? '/onboarding'

  const [alreadyAuthed, setAlreadyAuthed] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [agencyName, setAgencyName] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (data.user) setAlreadyAuthed(true)
    })
  }, [])

  const ready = alreadyAuthed
    ? agencyName.trim().length > 0
    : firstName.trim().length > 0 &&
      lastName.trim().length > 0 &&
      email.trim().length > 0 &&
      agencyName.trim().length > 0 &&
      mobile.trim().length > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()

    if (alreadyAuthed) {
      const { data } = await supabase.auth.getUser()
      const userEmail = data.user?.email ?? email
      const res = await fetch('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: agencyName, email: userEmail }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to create organisation')
        setLoading(false)
        return
      }
      window.location.href = redirectTo
      return
    }

    const callback = new URL('/auth/callback', window.location.origin)
    callback.searchParams.set('redirectTo', redirectTo)

    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim()

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        data: {
          full_name: fullName,
          pending_first_name: firstName.trim(),
          pending_last_name: lastName.trim(),
          pending_agency_name: agencyName.trim(),
          pending_mobile: mobile.trim(),
        },
        emailRedirectTo: callback.toString(),
        shouldCreateUser: true,
      },
    })

    if (otpError) {
      setError(otpError.message)
      setLoading(false)
      return
    }

    router.push(`/check-email?email=${encodeURIComponent(email)}`)
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form} noValidate>
      <div className={styles.gridTwo}>
        {!alreadyAuthed && (
          <>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="onb-first">First name</label>
              <input
                id="onb-first"
                className={styles.fieldInput}
                placeholder="Jane"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                autoComplete="given-name"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="onb-last">Last name</label>
              <input
                id="onb-last"
                className={styles.fieldInput}
                placeholder="Smith"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                autoComplete="family-name"
              />
            </div>
          </>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="onb-agency">Agency name</label>
        <input
          id="onb-agency"
          className={styles.fieldInput}
          placeholder="Smith Real Estate"
          value={agencyName}
          onChange={(e) => setAgencyName(e.target.value)}
          required
        />
      </div>

      {!alreadyAuthed && (
        <>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="onb-email">
              <span>Work email</span>
              <span className={styles.fieldHint}>We&apos;ll send your daily digest here</span>
            </label>
            <div className={styles.fieldInputWrap}>
              <span className={styles.fieldInputPrefix} aria-hidden="true"><Mail size={16} /></span>
              <input
                id="onb-email"
                className={`${styles.fieldInput} ${styles.hasPrefix}`}
                type="email"
                placeholder="agent@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="onb-mobile">
              <span>Mobile</span>
              <span className={styles.fieldHint}>For push alerts when a signal is worth your attention</span>
            </label>
            <div className={styles.fieldInputWrap}>
              <span className={styles.fieldInputPrefix} aria-hidden="true"><Phone size={16} /></span>
              <input
                id="onb-mobile"
                className={`${styles.fieldInput} ${styles.hasPrefix}`}
                type="tel"
                placeholder="0412 345 678"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                required
                autoComplete="tel"
              />
            </div>
          </div>
        </>
      )}

      <div className={styles.trustRow} aria-hidden="true">
        <span><Shield size={13} /> Your details stay yours</span>
        <span><CheckCircle2 size={13} /> No spam, ever</span>
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <div className={styles.actions}>
        <span className={styles.actionsHint}>14 days free · Cancel anytime</span>
        <button className={styles.submitBtn} type="submit" disabled={loading || !ready}>
          {loading
            ? 'Sending sign-in link…'
            : alreadyAuthed
              ? 'Create agency'
              : 'Email me a sign-in link'}
          <ArrowRight size={14} />
        </button>
      </div>
    </form>
  )
}
