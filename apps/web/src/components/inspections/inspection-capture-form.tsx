'use client'

/**
 * HOR-151 — Public capture form (prospect-facing, agent-branded).
 *
 * Two fields, one button, no Horace voice. The form:
 *
 *   1. On submit, reads the tracker's anonymous_id (`_riq_aid`) and
 *      session id (`_riq_sid`) from document.cookie. Generates either
 *      if missing — the cross-domain limitation is in the page-level
 *      doc; this form just guarantees both values are present when
 *      we POST.
 *   2. POSTs to /api/inspections/capture with token + name + mobile +
 *      anonymous_id + tracker_session_id + hp_email (honeypot).
 *   3. On 200, swaps to "Thanks. <Agent> will be in touch." That's it.
 *      No upsell, no further fields.
 *
 * Strings (H1, subhead, button, success, error labels) match the brief
 * verbatim. Voice is the agent's — Horace is never named.
 */

import { useState } from 'react'

interface Props {
  token: string
  agentFirstName: string
  brandColour?: string | null
}

const DEFAULT_BRAND = '#C4622D'

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return match ? decodeURIComponent(match[2]) : null
}

function setCookie(name: string, value: string, maxAgeSeconds: number) {
  if (typeof document === 'undefined') return
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback — sufficient for session keys, not for security.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function ensureCookies(): { anonymousId: string; trackerSessionId: string } {
  let anonymousId = readCookie('_riq_aid')
  if (!anonymousId) {
    anonymousId = uuid()
    setCookie('_riq_aid', anonymousId, 60 * 60 * 24 * 365) // 12 months
  }
  let trackerSessionId = readCookie('_riq_sid')
  if (!trackerSessionId) {
    trackerSessionId = uuid()
    setCookie('_riq_sid', trackerSessionId, 60 * 30) // 30 minutes
  }
  return { anonymousId, trackerSessionId }
}

export function InspectionCaptureForm({ token, agentFirstName, brandColour }: Props) {
  const brand = brandColour || DEFAULT_BRAND
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [hp, setHp] = useState('') // honeypot — must stay empty
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting || success) return

    if (!name.trim()) {
      setFieldError('name')
      setError('Please enter your name.')
      return
    }
    if (!mobile.trim()) {
      setFieldError('mobile')
      setError('Please enter your mobile number.')
      return
    }

    setSubmitting(true)
    setError(null)
    setFieldError(null)

    const { anonymousId, trackerSessionId } = ensureCookies()

    try {
      const res = await fetch('/api/inspections/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          name: name.trim(),
          mobile: mobile.trim(),
          anonymous_id: anonymousId,
          tracker_session_id: trackerSessionId,
          hp_email: hp,
        }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string; field?: string }
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.')
        if (data.field) setFieldError(data.field)
        setSubmitting(false)
        return
      }
      setSuccess(true)
    } catch {
      setError('Network error. Please try again.')
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0' }}>
        <p
          className="font-display"
          style={{ fontSize: 22, fontWeight: 500, color: '#3D332B', margin: 0 }}
        >
          Thanks. {agentFirstName} will be in touch.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {/* Honeypot — must stay empty. Hidden from humans, present in DOM. */}
      <label
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '-9999px',
          width: 1,
          height: 1,
          overflow: 'hidden',
        }}
      >
        Email
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={hp}
          onChange={(e) => setHp(e.target.value)}
        />
      </label>

      <div style={{ marginBottom: 16 }}>
        <label
          htmlFor="name"
          style={{
            display: 'block',
            fontSize: 13,
            color: '#5E5246',
            marginBottom: 6,
            fontWeight: 500,
          }}
        >
          Your name
        </label>
        <input
          id="name"
          type="text"
          autoComplete="name"
          autoFocus
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            width: '100%',
            padding: '14px 16px',
            fontSize: 16, // 16+ avoids iOS Safari zoom on focus
            background: '#FFFFFF',
            border: `1.5px solid ${fieldError === 'name' ? '#C4622D' : 'rgba(140,123,107,0.3)'}`,
            borderRadius: 8,
            color: '#3D332B',
            fontFamily: 'inherit',
            WebkitAppearance: 'none',
          }}
        />
      </div>

      <div style={{ marginBottom: 24 }}>
        <label
          htmlFor="mobile"
          style={{
            display: 'block',
            fontSize: 13,
            color: '#5E5246',
            marginBottom: 6,
            fontWeight: 500,
          }}
        >
          Mobile
        </label>
        <input
          id="mobile"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
          style={{
            width: '100%',
            padding: '14px 16px',
            fontSize: 16,
            background: '#FFFFFF',
            border: `1.5px solid ${fieldError === 'mobile' ? '#C4622D' : 'rgba(140,123,107,0.3)'}`,
            borderRadius: 8,
            color: '#3D332B',
            fontFamily: 'inherit',
            WebkitAppearance: 'none',
          }}
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        style={{
          width: '100%',
          padding: '16px',
          fontSize: 16,
          fontWeight: 500,
          background: submitting ? 'rgba(0,0,0,0.3)' : brand,
          color: '#FFFFFF',
          border: 'none',
          borderRadius: 8,
          cursor: submitting ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {submitting ? 'Saving…' : 'Done'}
      </button>

      {error && (
        <p
          role="alert"
          style={{
            marginTop: 14,
            padding: '10px 12px',
            background: 'rgba(196,98,45,0.08)',
            border: '1px solid rgba(196,98,45,0.25)',
            borderRadius: 6,
            fontSize: 13,
            color: '#9C4A1F',
          }}
        >
          {error}
        </p>
      )}
    </form>
  )
}
