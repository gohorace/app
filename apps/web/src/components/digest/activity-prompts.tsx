'use client'

import { useState } from 'react'
import { ArrowRight, Check, FileText, Link as LinkIcon, Mail } from 'lucide-react'

const TRACK_EMAIL = 'track@horace.co'

/**
 * Three Activity Prompt cards rendered inside the Digest empty state
 * (HOR-135). Horace prompts the agent to *generate* signal when there's
 * nothing to read.
 *
 * Wiring depth in V1:
 *   1. "Copy email address" — actually copies `track@horace.co`. Fully
 *      wired since clipboard is a primitive.
 *   2. "Generate tracked link" — placeholder until the link-picker modal
 *      ships. Renders disabled with a tooltip.
 *   3. "Start from template" — placeholder until the suburb-post template
 *      lands. Same disabled treatment.
 *
 * The deferred actions are honest about scope; the visual scaffold is
 * present so the design review can verify the layout end-to-end.
 */
export function ActivityPrompts() {
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
        <span
          style={{
            fontSize: 11,
            color: '#8C7B6B',
            fontStyle: 'italic',
          }}
        >
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
        <CopyTrackEmailCard />
        <PromptCard
          Icon={LinkIcon}
          title="Share a property link"
          body="Generate a tracked link to a listing. Horace will tell you when they come back to look."
          cta="Generate tracked link"
          disabled
          disabledTooltip="Tracked-link picker coming soon"
        />
        <PromptCard
          Icon={FileText}
          title="Post a suburb update"
          body="A 200-word post on recent activity in your patch travels further than you’d think."
          cta="Start from template"
          disabled
          disabledTooltip="Suburb-post template coming soon"
        />
      </div>
    </div>
  )
}

function CopyTrackEmailCard() {
  const [copied, setCopied] = useState(false)
  async function copy(e: React.MouseEvent) {
    e.preventDefault()
    try {
      await navigator.clipboard.writeText(TRACK_EMAIL)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // clipboard refused — silent. The visible address still shows on hover.
    }
  }
  return (
    <PromptCard
      Icon={Mail}
      title="Send a tracked update"
      body={
        <>
          Forward an email to{' '}
          <span style={{ fontFamily: 'var(--font-mono)', color: '#1A1612' }}>{TRACK_EMAIL}</span>
          {' '}— Horace will watch what they do after they open it.
        </>
      }
      cta={copied ? 'Copied' : 'Copy email address'}
      ctaIcon={copied ? Check : ArrowRight}
      onClick={copy}
    />
  )
}

interface PromptCardProps {
  Icon: typeof Mail
  title: string
  body: React.ReactNode
  cta: string
  ctaIcon?: typeof ArrowRight
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
  onClick,
  disabled,
  disabledTooltip,
}: PromptCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabledTooltip}
      style={{
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
      }}
    >
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
    </button>
  )
}
