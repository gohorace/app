import { SignalCard, type DigestSignal } from './signal-card'

export interface DigestViewModel {
  /** Human date the digest is for ("Wednesday, 13 May"). Computed server-side. */
  dateLabel: string
  /** Time the cron ran today, formatted ("6:02 am"). Optional. */
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
}

interface DigestViewProps {
  model: DigestViewModel
}

/**
 * Top-level Digest layout. Renders one of two states:
 *  - **Ranked roster** (when there are signals) — Horace opener + cards + signoff.
 *  - **Empty / "A quiet one"** — design's deferred-CTA empty state without wired actions.
 *
 * Single component for both desktop + mobile; the opener card's 3-stat row
 * wraps on narrow viewports. The page is wrapped in the dashboard layout's
 * sidebar/main split, so this just owns the column content.
 */
export function DigestView({ model }: DigestViewProps) {
  if (model.signals.length === 0) {
    return <EmptyState dateLabel={model.dateLabel} />
  }

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
          maxWidth: 760,
          margin: '0 auto',
          padding: '28px 20px 28px',
        }}
      >
        {/* Eyebrow */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: '#8C7B6B',
            marginBottom: 18,
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
          Today&rsquo;s digest · {model.dateLabel}
        </div>

        {/* Horace opener card (charcoal) */}
        <section
          style={{
            background: '#2E2823',
            borderRadius: 12,
            padding: '20px 22px 22px',
            marginBottom: 24,
            color: '#F5F0E8',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
              marginBottom: 14,
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: '0.04em',
                color: 'rgba(245,240,232,0.55)',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#C4622D',
                }}
              />
              Horace
              {model.sentAtLabel && <span>· {model.sentAtLabel}</span>}
            </div>
            <DigestStats stats={model.stats} />
          </div>

          <h1
            className="font-display"
            style={{
              margin: 0,
              fontSize: 24,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              lineHeight: 1.3,
              color: '#F5F0E8',
            }}
          >
            Here&rsquo;s what Horace picked up overnight.
          </h1>

          {model.narrative && (
            <p
              style={{
                margin: '12px 0 0',
                fontSize: 14,
                lineHeight: 1.6,
                color: 'rgba(245,240,232,0.88)',
                fontStyle: 'italic',
              }}
            >
              &ldquo;{model.narrative}&rdquo;
            </p>
          )}

          <div
            style={{
              marginTop: 16,
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.08em',
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
            marginBottom: 12,
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
            gap: 12,
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
            gap: 12,
            marginTop: 28,
            color: '#8C7B6B',
            fontSize: 11,
            fontStyle: 'italic',
          }}
        >
          <span style={{ flex: 1, height: 1, background: 'rgba(140,123,107,0.2)' }} />
          That&rsquo;s the morning. — Horace
          <span style={{ flex: 1, height: 1, background: 'rgba(140,123,107,0.2)' }} />
        </div>
      </div>
    </div>
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
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
      {cells.map((c) => (
        <div key={c.lbl} style={{ textAlign: 'left' }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 600,
              color: c.accent ?? '#F5F0E8',
              letterSpacing: '-0.01em',
              lineHeight: 1,
            }}
          >
            {c.val}
          </div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'rgba(245,240,232,0.55)',
              marginTop: 4,
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

function EmptyState({ dateLabel }: { dateLabel: string }) {
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
          maxWidth: 620,
          margin: '0 auto',
          padding: '28px 20px 28px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: '#8C7B6B',
            marginBottom: 18,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#3D5246',
            }}
          />
          Today&rsquo;s digest · {dateLabel}
        </div>

        <h1
          className="font-display"
          style={{
            margin: '0 0 12px',
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            lineHeight: 1.15,
            color: '#1A1612',
          }}
        >
          A quiet one.
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: 15,
            lineHeight: 1.6,
            color: '#5E5246',
            maxWidth: 540,
          }}
        >
          Nothing&rsquo;s stirring on your site today — which makes this a good morning to make
          some noise of your own.
        </p>

        {/* Horace prompt card */}
        <div
          style={{
            marginTop: 24,
            padding: '18px 20px',
            background: '#FAF7F2',
            border: '1px solid rgba(140,123,107,0.2)',
            borderRadius: 12,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#8C7B6B',
              marginBottom: 8,
            }}
          >
            Horace says
          </div>
          <p
            className="horace-nudge"
            style={{
              margin: 0,
              fontSize: 15,
              lineHeight: 1.65,
              color: '#1A1612',
            }}
          >
            Looking at your last 14 days — when something stirs, you&rsquo;ll hear it here first.
          </p>
        </div>

        <p
          style={{
            marginTop: 18,
            fontSize: 12,
            color: '#8C7B6B',
            fontStyle: 'italic',
          }}
        >
          Horace will tell you when something stirs.
        </p>
      </div>
    </div>
  )
}
