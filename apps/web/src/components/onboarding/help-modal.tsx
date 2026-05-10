'use client'

import { useEffect, useState } from 'react'
import { X, Mail, Link2, Calendar, Check, Copy } from 'lucide-react'
import styles from './help-modal.module.css'

export type HelpKind = 'email' | 'share' | 'book'

interface Props {
  kind: HelpKind | null
  snippet: string
  snippetKey: string
  appUrl: string
  onClose: () => void
}

export function HelpModal({ kind, snippet, snippetKey, appUrl, onClose }: Props) {
  useEffect(() => {
    if (!kind) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [kind, onClose])

  if (!kind) return null

  const titles: Record<HelpKind, { icon: React.ReactNode; title: string; sub: string }> = {
    email: {
      icon: <Mail size={18} />,
      title: 'Send the snippet to your web person',
      sub: 'They paste, you proceed. We’ll email it on your behalf.',
    },
    share: {
      icon: <Link2 size={18} />,
      title: 'Share a private install link',
      sub: 'Send this link to anyone who can paste a script. No login required.',
    },
    book: {
      icon: <Calendar size={18} />,
      title: 'Book a 15-min install call',
      sub: 'Pick a slot. We’ll screen-share and get you live in minutes.',
    },
  }

  const t = titles[kind]

  return (
    <div className={styles.backdrop} onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="help-modal-title">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <header className={styles.header}>
          <div className={styles.headerIcon}>{t.icon}</div>
          <div>
            <h2 id="help-modal-title" className={styles.title}>{t.title}</h2>
            <p className={styles.sub}>{t.sub}</p>
          </div>
        </header>

        <div className={styles.body}>
          {kind === 'email' && <EmailDeveloper snippet={snippet} onClose={onClose} />}
          {kind === 'share' && <ShareLink snippetKey={snippetKey} appUrl={appUrl} />}
          {kind === 'book'  && <BookCall />}
        </div>
      </div>
    </div>
  )
}

function EmailDeveloper({ snippet, onClose }: { snippet: string; onClose: () => void }) {
  const [to, setTo] = useState('')
  const [message, setMessage] = useState(
    `Hi,\n\nCould you paste the snippet below into our website's <head> on every page? We're setting up Horace, which gives me real-time signals on serious vendors.\n\nSnippet:\n${snippet}\n\nIt's a one-line install — Horace will confirm it's working as soon as the next visitor lands. Thanks!`,
  )
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    setSending(true); setError(null)
    try {
      const res = await fetch('/api/onboarding/email-developer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, message }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to send. Please try again.')
        setSending(false)
        return
      }
      setSent(true)
      setTimeout(onClose, 1500)
    } catch {
      setError('Network error. Please try again.')
      setSending(false)
    }
  }

  if (sent) {
    return (
      <div className={styles.successState}>
        <div className={styles.successIcon}><Check size={28} /></div>
        <p className={styles.successText}>Sent. We’ll let you know the moment they paste.</p>
      </div>
    )
  }

  return (
    <div className={styles.formStack}>
      <label className={styles.fieldLabel} htmlFor="hm-to">Their email</label>
      <input
        id="hm-to"
        type="email"
        className={styles.fieldInput}
        placeholder="developer@example.com"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        required
        autoComplete="email"
      />

      <label className={styles.fieldLabel} htmlFor="hm-msg">Message</label>
      <textarea
        id="hm-msg"
        className={`${styles.fieldInput} ${styles.fieldTextarea}`}
        rows={10}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actionRow}>
        <button className={styles.btnPrimary} onClick={send} disabled={!to.trim() || sending} type="button">
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}

function ShareLink({ snippetKey, appUrl }: { snippetKey: string; appUrl: string }) {
  const url = `${appUrl}/install/${snippetKey}`
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={styles.formStack}>
      <p className={styles.helperText}>
        Anyone with this link can see your install instructions and the snippet — but cannot access your dashboard.
      </p>
      <div className={styles.copyBox}>
        <code className={styles.copyBoxUrl}>{url}</code>
        <button className={styles.copyBtn} onClick={copy} type="button">
          {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}
        </button>
      </div>
    </div>
  )
}

function BookCall() {
  const username = process.env.NEXT_PUBLIC_CAL_USERNAME
  const eventSlug = process.env.NEXT_PUBLIC_CAL_EVENT_SLUG

  if (!username || !eventSlug) {
    return (
      <div className={styles.formStack}>
        <p className={styles.helperText}>
          Booking isn’t configured yet. Email us at{' '}
          <a href="mailto:hello@gohorace.com?subject=Book%20install%20call" className={styles.link}>
            hello@gohorace.com
          </a>{' '}
          and we’ll send a few times.
        </p>
      </div>
    )
  }

  const calUrl = `https://cal.com/${username}/${eventSlug}?embed=true&layout=month_view`
  return (
    <div className={styles.calWrap}>
      <iframe
        src={calUrl}
        title="Book a 15-minute install call"
        className={styles.calFrame}
        loading="lazy"
      />
    </div>
  )
}
