'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  Check,
  Download,
  Mail,
  Send,
  Share2,
} from 'lucide-react'

interface ActivityPromptsProps {
  /** Workspace site URL (agent_settings.website_url). Card (a) copies this. */
  websiteUrl: string | null
}

/**
 * Three Activity Prompt cards rendered inside the Digest empty state.
 *
 * Replaces the misleading "Send a tracked update → track@horace.co" copy
 * (HOR-138). All three CTAs map to real Horace surfaces:
 *
 *   (a) Post on social — copies the agent's site URL. The tracker on
 *       their site captures every visitor; anonymous now, named the
 *       moment they identify themselves.
 *
 *   (b) Send a tracked prospect email — navigates to /contacts where the
 *       agent picks a contact and uses HOR-136's per-contact tracked
 *       link (Copy button).
 *
 *   (c) Send a tracked newsletter — downloads /api/contacts/export.csv
 *       with every contact's tracked URL as a column. The agent imports
 *       into Mailchimp / Klaviyo / Gmail mail-merge and drives the send
 *       from their own tool. Personalisation happens in the agent's
 *       tool; Horace contributes the per-recipient tokens.
 *
 * When `websiteUrl` is null (agent hasn't set their site yet), card (a)
 * routes to /settings/tracked-links instead of attempting to copy.
 */
export function ActivityPrompts({ websiteUrl }: ActivityPromptsProps) {
  return (
    <div style={{ marginTop: 28 }}>
      {/* Section header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 14,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#5E5246',
          }}
        >
          Three ways to seed the next signal
        </span>
        <span style={{ fontSize: 11, color: '#8C7B6B', fontStyle: 'italic' }}>
          Horace&rsquo;s suggestions
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        <ShareSiteLinkCard websiteUrl={websiteUrl} />
        <ProspectEmailCard />
        <NewsletterCsvCard />
      </div>
    </div>
  )
}

// ── Card 1 — Post on social using your tracked site link ─────────────────────

function ShareSiteLinkCard({ websiteUrl }: { websiteUrl: string | null }) {
  const [copied, setCopied] = useState(false)

  if (!websiteUrl) {
    // No site configured yet — point them to Settings to set one.
    return (
      <PromptCard
        Icon={Share2}
        title="Post on social"
        body={
          <>
            Drop your site link into a post. Horace catches every visitor — anonymous now,
            named the moment they reach out. <strong>Set your site link first →</strong>
          </>
        }
        cta="Open settings"
        ctaIcon={ArrowRight}
        href="/settings/tracked-links"
      />
    )
  }

  async function copy(e: React.MouseEvent) {
    e.preventDefault()
    try {
      await navigator.clipboard.writeText(websiteUrl ?? '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard refused — silent */
    }
  }

  return (
    <PromptCard
      Icon={Share2}
      title="Post on social"
      body={
        <>
          Drop your site link into a post. Horace catches every visitor —
          anonymous now, named the moment they reach out.
        </>
      }
      cta={copied ? 'Copied' : 'Copy your site link'}
      ctaIcon={copied ? Check : ArrowRight}
      onClick={copy}
    />
  )
}

// ── Card 2 — Send a tracked prospect email ───────────────────────────────────

function ProspectEmailCard() {
  return (
    <PromptCard
      Icon={Mail}
      title="Send a tracked prospect email"
      body={
        <>
          Pick a contact, send from your inbox. Horace tells you the moment they
          click through.
        </>
      }
      cta="Pick a contact"
      ctaIcon={ArrowRight}
      href="/contacts"
    />
  )
}

// ── Card 3 — Send a tracked newsletter via CSV export ────────────────────────

function NewsletterCsvCard() {
  const [downloading, setDownloading] = useState(false)

  async function download(e: React.MouseEvent) {
    e.preventDefault()
    if (downloading) return
    setDownloading(true)
    try {
      // Trigger the download by navigating in a hidden iframe-style request.
      // Using a same-origin <a download> click is cleaner than fetch->blob
      // because the browser handles the filename + content-disposition.
      const a = document.createElement('a')
      a.href = '/api/contacts/export.csv'
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } finally {
      // Reset quickly — there's no completion signal from <a download>.
      setTimeout(() => setDownloading(false), 1200)
    }
  }

  return (
    <PromptCard
      Icon={Send}
      title="Send a tracked newsletter"
      body={
        <>
          Bulk reach, individual signal. Export your contacts with their tracked
          links — drop into your newsletter tool and Horace will tell you who
          actually leaned in.
        </>
      }
      cta={downloading ? 'Preparing…' : 'Export contacts as CSV'}
      ctaIcon={downloading ? Check : Download}
      onClick={download}
    />
  )
}

// ── Generic card primitive ───────────────────────────────────────────────────

interface PromptCardProps {
  Icon: typeof Mail
  title: string
  body: React.ReactNode
  cta: string
  ctaIcon?: typeof ArrowRight
  /** If set, the card is rendered as a Next <Link>. */
  href?: string
  /** If set, the card is rendered as a <button> with this handler. */
  onClick?: (e: React.MouseEvent) => void
  disabled?: boolean
  disabledTooltip?: string
}

function PromptCard({
  Icon,
  title,
  body,
  cta,
  ctaIcon: CtaIcon = ArrowRight,
  href,
  onClick,
  disabled,
  disabledTooltip,
}: PromptCardProps) {
  const inner = (
    <>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: 'rgba(196,98,45,0.12)',
          color: '#C4622D',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon style={{ width: 16, height: 16 }} aria-hidden />
      </div>
      <div
        className="font-display"
        style={{
          fontSize: 16,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          color: '#1A1612',
        }}
      >
        {title}
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: '#5E5246',
          lineHeight: 1.55,
          flex: 1,
        }}
      >
        {body}
      </p>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          marginTop: 4,
          fontSize: 12,
          fontWeight: 500,
          color: '#C4622D',
        }}
      >
        {cta}
        <CtaIcon style={{ width: 12, height: 12 }} aria-hidden />
      </div>
    </>
  )

  const sharedStyle: React.CSSProperties = {
    textAlign: 'left',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '18px 18px 16px',
    background: '#FAF7F2',
    border: '1px solid rgba(140,123,107,0.2)',
    borderRadius: 12,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.7 : 1,
    fontFamily: 'var(--font-body)',
    color: '#1A1612',
    transition: 'box-shadow 180ms, border-color 180ms',
    textDecoration: 'none',
  }

  if (href && !disabled) {
    return (
      <Link href={href} style={sharedStyle}>
        {inner}
      </Link>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabledTooltip}
      style={sharedStyle}
    >
      {inner}
    </button>
  )
}
