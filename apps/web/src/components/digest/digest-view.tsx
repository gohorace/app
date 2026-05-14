import Image from 'next/image'
import Link from 'next/link'
import { Archive, SlidersHorizontal } from 'lucide-react'
import { SignalCard, type DigestSignal } from './signal-card'
import { DigestRail, type DigestRailData } from './digest-rail'
import { ActivityPrompts } from './activity-prompts'

export interface DigestViewModel {
  /** Human date the digest is for ("Wednesday, 13 May"). Computed server-side. */
  dateLabel: string
  /** Time the digest was generated, formatted ("6:02 am"). Optional. */
  sentAtLabel: string | null
  /** Horace-voiced narrative paragraph (2–3 sentences). May be empty. */
  narrative: string
  signals: DigestSignal[]
  /** Counters shown in the Horace opener card. */
  stats: {
    worthAttention: number
    highIntent: number
    newlyKnown: number
  }
  /** Right-rail content. */
  rail: DigestRailData
  /** Workspace website URL — used by the empty-state ActivityPrompts to seed
   *  the "Post on social" copy. Null when the agent hasn't set their site yet. */
  websiteUrl: string | null
  /** When true, a "DEMO DATA" chip renders so reviewers know this is mock. */
  isDemo?: boolean
}

interface DigestViewProps {
  model: DigestViewModel
}

/**
 * Top-level Digest layout. Three-column shell:
 *  - [sidebar from layout]
 *  - main content column (left-anchored, no max-width centring)
 *  - right rail (~280px, lg breakpoint and up)
 *
 * Two states inside the main column:
 *  - **Ranked roster** — Horace opener + signal cards.
 *  - **Empty / "A quiet one"** — design's deferred-CTA empty state.
 */
export function DigestView({ model }: DigestViewProps) {
  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 32,
          padding: '28px 32px 0',
          alignItems: 'flex-start',
        }}
      >
        {/* Main column — left-anchored, takes remaining space up to a cap */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            maxWidth: 760,
          }}
        >
          <PageTopbar dateLabel={model.dateLabel} isDemo={model.isDemo} />
          {model.signals.length === 0
            ? <EmptyState websiteUrl={model.websiteUrl} />
            : <PopulatedState model={model} />}
        </div>

        {/* Right rail — hidden below lg */}
        <DigestRail data={model.rail} />
      </div>
    </div>
  )
}

// ── Page-level topbar (crumb + h1 + right-side actions) ─────────────────────

function PageTopbar({ dateLabel, isDemo }: { dateLabel: string; isDemo?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 22,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#8C7B6B',
            marginBottom: 8,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#C4622D',
            }}
          />
          Today · {dateLabel}
          {isDemo && (
            <span
              style={{
                marginLeft: 8,
                padding: '2px 8px',
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: '0.1em',
                color: '#9C4A1F',
                background: 'rgba(196,98,45,0.12)',
                borderRadius: 4,
              }}
            >
              DEMO DATA
            </span>
          )}
        </div>
        <h1
          className="font-display"
          style={{
            margin: 0,
            fontSize: 36,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            lineHeight: 1.15,
            color: '#1A1612',
          }}
        >
          Today&rsquo;s digest
        </h1>
      </div>

      {/* Right-side action buttons — Past digests + Preferences */}
      <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginTop: 4 }}>
        <button
          type="button"
          disabled
          title="Past digests — coming soon"
          style={ghostButtonStyle}
        >
          <Archive style={{ width: 13, height: 13 }} aria-hidden />
          Past digests
        </button>
        <Link
          href="/settings/notifications"
          title="Notification preferences"
          style={{
            ...ghostButtonStyle,
            opacity: 1,
            cursor: 'pointer',
            textDecoration: 'none',
          }}
        >
          <SlidersHorizontal style={{ width: 13, height: 13 }} aria-hidden />
          Preferences
        </Link>
      </div>
    </div>
  )
}

const ghostButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 12px',
  fontSize: 12,
  fontWeight: 500,
  color: '#5E5246',
  background: '#FAF7F2',
  border: '1px solid rgba(140,123,107,0.3)',
  borderRadius: 7,
  cursor: 'not-allowed',
  opacity: 0.75,
  fontFamily: 'var(--font-body)',
}

// ── Populated state ──────────────────────────────────────────────────────────

function PopulatedState({ model }: { model: DigestViewModel }) {
  return (
    <>
      {/* Horace opener (charcoal card) */}
      <section
        style={{
          background: '#2E2823',
          borderRadius: 14,
          padding: '22px 24px 24px',
          marginBottom: 26,
          color: '#F5F0E8',
        }}
      >
        {/* Top row: Horace identity (left) + stats (right) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 24,
            flexWrap: 'wrap',
            marginBottom: 18,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Image
              src="/horace-charcoal.png"
              alt=""
              width={48}
              height={48}
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: '#2E2823',
                flexShrink: 0,
              }}
            />
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'rgba(245,240,232,0.55)',
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: '#C4622D',
                }}
              />
              Horace
              {model.sentAtLabel && <span>· {model.sentAtLabel}</span>}
            </div>
          </div>

          <DigestStats stats={model.stats} />
        </div>

        {/* Narrative quote */}
        {model.narrative && (
          <p
            className="font-display"
            style={{
              margin: 0,
              fontSize: 19,
              lineHeight: 1.55,
              fontStyle: 'italic',
              fontWeight: 400,
              color: 'rgba(245,240,232,0.92)',
              letterSpacing: '-0.005em',
            }}
          >
            &ldquo;{model.narrative}&rdquo;
          </p>
        )}

        <div
          style={{
            marginTop: 18,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'rgba(245,240,232,0.45)',
          }}
        >
          Seize the moment — Horace
        </div>
      </section>

      {/* Section heading */}
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
          Ranked by urgency
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: '#8C7B6B',
          }}
        >
          {model.signals.length} {model.signals.length === 1 ? 'contact' : 'contacts'}
        </span>
      </div>

      {/* Ranked roster */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {model.signals.map((s) => (
          <SignalCard key={s.contactId} signal={s} />
        ))}
      </div>

      {/* Closing rule + signoff */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginTop: 32,
          color: '#8C7B6B',
          fontSize: 11,
          fontStyle: 'italic',
        }}
      >
        <span style={{ flex: 1, height: 1, background: 'rgba(140,123,107,0.2)' }} />
        That&rsquo;s the morning. — Horace
        <span style={{ flex: 1, height: 1, background: 'rgba(140,123,107,0.2)' }} />
      </div>
    </>
  )
}

// ── Stats row inside the Horace opener card ──────────────────────────────────

function DigestStats({ stats }: { stats: DigestViewModel['stats'] }) {
  const cells: Array<{ val: number; lbl: string; accent?: string }> = [
    { val: stats.worthAttention, lbl: 'Worth attention' },
    { val: stats.highIntent,     lbl: 'High intent', accent: '#E8956D' },
    { val: stats.newlyKnown,     lbl: 'Newly known' },
  ]
  return (
    <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
      {cells.map((c) => (
        <div key={c.lbl}>
          <div
            className="font-display"
            style={{
              fontSize: 32,
              fontWeight: 600,
              color: c.accent ?? '#F5F0E8',
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}
          >
            {c.val}
          </div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'rgba(245,240,232,0.5)',
              marginTop: 6,
            }}
          >
            {c.lbl}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Empty state — "A quiet one" ──────────────────────────────────────────────
// HOR-135 #4: empty state now includes three Activity Prompt cards so the
// surface is active rather than purely informational. Horace prompts the
// agent to generate signal when there's nothing to read.

function EmptyState({ websiteUrl }: { websiteUrl: string | null }) {
  return (
    <>
      <p
        style={{
          margin: '0 0 24px',
          fontSize: 16,
          lineHeight: 1.65,
          color: '#5E5246',
          maxWidth: 600,
        }}
      >
        Nothing&rsquo;s stirring on your site today — which makes this a good morning to make
        some noise of your own.
      </p>

      <div
        style={{
          padding: '20px 22px',
          background: '#FAF7F2',
          border: '1px solid rgba(140,123,107,0.2)',
          borderRadius: 12,
          display: 'flex',
          gap: 14,
          alignItems: 'flex-start',
        }}
      >
        <Image
          src="/horace-charcoal.png"
          alt=""
          width={36}
          height={36}
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: '#2E2823',
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#8C7B6B',
              marginBottom: 6,
            }}
          >
            Horace says
          </div>
          <p
            className="horace-nudge"
            style={{
              margin: 0,
              fontSize: 16,
              lineHeight: 1.65,
              color: '#1A1612',
            }}
          >
            Looking at your last 14 days — when something stirs, you&rsquo;ll hear it here first.
          </p>
        </div>
      </div>

      <ActivityPrompts websiteUrl={websiteUrl} />
    </>
  )
}
