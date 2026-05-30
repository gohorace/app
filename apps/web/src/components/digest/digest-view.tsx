'use client'

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Archive, SlidersHorizontal, Check, Feather } from 'lucide-react'
import { SignalCard, isWorkableSignal, type DigestSignal, type SignalTier } from './signal-card'
import { DigestRail, type DigestRailData } from './digest-rail'
import { ActivityPrompts } from './activity-prompts'
import { BellButton } from '@/components/dashboard/bell-button'
import { useCompanion } from '@/components/companion/companion-context'

export interface DigestViewModel {
  /** Human date the digest is for ("Wednesday, 13 May"). Computed server-side. */
  dateLabel: string
  /** Time the digest was generated, formatted ("6:02 am"). Optional. */
  sentAtLabel: string | null
  /** Horace-voiced narrative paragraph (2–3 sentences). May be empty.
   *  v2: no longer rendered as a charcoal opener — surfaced on demand via the
   *  Ask Horace companion (Phase 1). Retained for compatibility / fallback. */
  narrative: string
  signals: DigestSignal[]
  /** Counters (legacy — the charcoal opener that showed these was removed in
   *  v2). Kept so the server model stays stable across phases. */
  stats: {
    worthAttention: number
    highIntent: number
    newlyKnown: number
  }
  /** Right-rail content. */
  rail: DigestRailData
  /** Workspace website URL — used by the empty-state ActivityPrompts. */
  websiteUrl: string | null
  /**
   * When true, a labelled chip renders to signal this is illustrative data.
   * - `'demo'` — explicit `?demo=1` review mode: shows "DEMO DATA" (QA/design).
   * - `'preview'` — no-signal-yet mode: shows "SAMPLE DATA" so new agents
   *    understand the surface is previewing what their digest will look like.
   * Passing `true` is treated the same as `'demo'` for backwards compatibility.
   */
  isDemo?: boolean | 'demo' | 'preview'
  /** Bell badge count — high-intent contacts + unread notifications. */
  attentionCount?: number
}

interface DigestViewProps {
  model: DigestViewModel
}

const TIER_ORDER: SignalTier[] = ['act-now', 'worth-a-look', 'ambient']
const TIER_LABEL: Record<SignalTier, string> = {
  'act-now': 'Act now — today',
  'worth-a-look': 'Worth a look',
  ambient: 'Ambient',
}

/**
 * Top-level Digest ("Today's activity") layout. Three-column shell:
 *  - [sidebar from layout]
 *  - main content column (left-anchored, capped width)
 *  - right rail (~280px, lg and up)
 *
 * Two states inside the main column:
 *  - **Stream** — the ranked, tier-grouped roster of signal cards.
 *  - **Empty / "A quiet one"** — deferred-CTA empty state.
 */
export function DigestView({ model }: DigestViewProps) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 80 }}>
      <div style={{ display: 'flex', gap: 32, padding: '28px 32px 0', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0, maxWidth: 760 }}>
          <ActivityHeader
            dateLabel={model.dateLabel}
            isDemo={model.isDemo}
            attentionCount={model.attentionCount ?? 0}
          />
          {model.signals.length === 0 ? (
            <EmptyState websiteUrl={model.websiteUrl} />
          ) : (
            <Stream signals={model.signals} dateLabel={model.dateLabel} />
          )}
        </div>

        <DigestRail data={model.rail} />
      </div>
    </div>
  )
}

// ── Activity header — title + crumb + three-tier action cluster ──────────────

function ActivityHeader({
  dateLabel,
  isDemo,
  attentionCount,
}: {
  dateLabel: string
  isDemo?: boolean
  attentionCount: number
}) {
  const { openCompanion } = useCompanion()
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 20,
        marginBottom: 22,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11.5,
            fontWeight: 500,
            color: '#8C7B6B',
            marginBottom: 8,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#C4622D' }} />
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
              {isDemo === 'preview' ? 'SAMPLE DATA' : 'DEMO DATA'}
            </span>
          )}
        </div>
        <h1
          className="font-display"
          style={{ margin: 0, fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.15, color: '#1A1612' }}
        >
          Today&rsquo;s activity
        </h1>
      </div>

      {/* Three-tier hierarchy: quiet utility icons · divider · accent Ask pill.
        * Solid Send on the card is the primary tier (handled in SignalCard). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginTop: 4 }}>
        <button type="button" disabled title="Past activity — coming soon" aria-label="Past activity" style={iconBtnStyle}>
          <Archive style={{ width: 16, height: 16 }} aria-hidden />
        </button>
        <Link
          href="/settings/notifications"
          title="Preferences"
          aria-label="Preferences"
          style={{ ...iconBtnStyle, cursor: 'pointer', opacity: 1 }}
        >
          <SlidersHorizontal style={{ width: 16, height: 16 }} aria-hidden />
        </Link>
        <BellButton attentionCount={attentionCount} />
        <span style={{ width: 1, height: 22, background: 'rgba(140,123,107,0.28)', margin: '0 2px' }} />
        <button type="button" onClick={() => openCompanion()} style={askPillStyle}>
          <Feather style={{ width: 15, height: 15 }} aria-hidden />
          Ask Horace
        </button>
      </div>
    </div>
  )
}

const iconBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 34,
  height: 34,
  color: '#8C7B6B',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 8,
  cursor: 'not-allowed',
  opacity: 0.75,
}

const askPillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  padding: '9px 16px',
  fontSize: 13,
  fontWeight: 600,
  color: '#FAF7F2',
  background: '#C4622D',
  border: '1px solid #C4622D',
  borderRadius: 8,
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
  whiteSpace: 'nowrap',
  boxShadow: '0 1px 3px rgba(196,98,45,0.25)',
}

// ── Stream — the ranked, tier-grouped roster + live counter ───────────────────

function Stream({ signals, dateLabel }: { signals: DigestSignal[]; dateLabel: string }) {
  // Decisions made this session, keyed by contactId. Lifted here so the live
  // counter can tick down across the whole stream (§3). Reset per day/data.
  const [cleared, setCleared] = useState<Set<string>>(() => new Set())
  const markCleared = useCallback((id: string) => {
    setCleared((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])
  useEffect(() => setCleared(new Set()), [dateLabel])

  // Ambient cards are dashboard residue on a busy day — suppress them when
  // there's real work in the stream. They stand alone only on a quiet day (§4).
  const hasRealWork = signals.some((s) => s.tier !== 'ambient')
  const visible = hasRealWork ? signals.filter((s) => s.tier !== 'ambient') : signals

  const workable = visible.filter(isWorkableSignal)
  const unworked = workable.filter((s) => !cleared.has(s.contactId)).length

  const groups = TIER_ORDER.map((tier) => ({
    tier,
    items: visible.filter((s) => s.tier === tier),
  })).filter((g) => g.items.length > 0)

  return (
    <>
      {/* Section heading — "Stream" + the live signal counter */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#5E5246', letterSpacing: '0.01em' }}>Stream</span>
        {unworked > 0 ? (
          <span style={counterLiveStyle}>
            <span style={counterDotStyle} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 500 }}>{unworked}</span> to clear
          </span>
        ) : (
          <span style={counterClearStyle}>
            <Check style={{ width: 13, height: 13 }} aria-hidden /> All clear
          </span>
        )}
      </div>

      {/* Ranked roster, grouped by tier */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        {groups.map((g) => (
          <div key={g.tier} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {groups.length > 1 && (
              <div style={{ fontSize: 11.5, fontWeight: 600, color: '#9C4A1F', letterSpacing: '0.01em' }}>
                {TIER_LABEL[g.tier]}
              </div>
            )}
            {g.items.map((s) => (
              <SignalCard key={s.contactId} signal={s} onClear={markCleared} />
            ))}
          </div>
        ))}
      </div>

      {/* Closing rule + signoff */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginTop: 30,
          color: '#8C7B6B',
          fontSize: 11.5,
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

const counterLiveStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  fontSize: 12,
  fontWeight: 500,
  color: '#9C4A1F',
  background: 'rgba(196,98,45,0.1)',
  border: '1px solid rgba(196,98,45,0.22)',
  borderRadius: 9999,
  padding: '4px 11px 4px 9px',
}

const counterDotStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: '#C4622D',
  flexShrink: 0,
  animation: 'pulseDot 1.8s ease-out infinite',
}

const counterClearStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  fontWeight: 500,
  color: '#3D5246',
  background: 'rgba(61,82,70,0.1)',
  border: '1px solid rgba(61,82,70,0.2)',
  borderRadius: 9999,
  padding: '4px 12px',
}

// ── Empty state — "A quiet one" ──────────────────────────────────────────────

function EmptyState({ websiteUrl }: { websiteUrl: string | null }) {
  return (
    <>
      <p style={{ margin: '0 0 24px', fontSize: 16, lineHeight: 1.65, color: '#5E5246', maxWidth: 600 }}>
        Nothing&rsquo;s stirring on your site today — which makes this a good morning to make some noise of your own.
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
          style={{ width: 36, height: 36, borderRadius: '50%', background: '#2E2823', flexShrink: 0 }}
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
          <p className="horace-nudge" style={{ margin: 0, fontSize: 16, lineHeight: 1.65, color: '#1A1612' }}>
            Looking at your last 14 days — when something stirs, you&rsquo;ll hear it here first.
          </p>
        </div>
      </div>

      <ActivityPrompts websiteUrl={websiteUrl} />
    </>
  )
}
