'use client'

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, SlidersHorizontal, Check, Feather } from 'lucide-react'
import { isWorkableSignal, type DigestSignal, type SignalIdentity } from './signal-card'
import { StreamCardMini, type StreamCardData, type StreamTier } from './stream-card'
import { DigestRail, type DigestRailData } from './digest-rail'
import { ActivityPrompts } from './activity-prompts'
import { BellButton } from '@/components/dashboard/bell-button'
import { useCompanion } from '@/components/companion/companion-context'
import { useComposerDock } from '@/components/email/composer-dock-context'

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

// Feed order + headings, cooling down the column (handoff Tier table).
const STREAM_TIER_ORDER: StreamTier[] = ['act', 'heating', 'cooling', 'steady', 'quiet']
const STREAM_TIER_LABEL: Record<StreamTier, string> = {
  act: 'Act now — today',
  heating: 'Heating up',
  cooling: 'Cooling down',
  steady: 'Steady',
  quiet: 'Quiet',
}

// ── DigestSignal → StreamCardMini mapping (HOR-363 / HOR-365) ─────────────────
// A signal's Stream tier is its explicit `streamTier` when set (e.g. a
// cooling-down contact merged in from outside the active roster), otherwise
// derived from the legacy tier + intent the briefing RPC still emits.
function streamTierFor(signal: DigestSignal): StreamTier {
  if (signal.streamTier) return signal.streamTier
  if (signal.tier === 'act-now') return 'act'
  if (signal.tier === 'ambient') return 'quiet'
  return signal.intent === 'high' ? 'heating' : 'steady'
}

// Handoff shows Known / Unknown; reconciled here with the digest identity
// states. 'probable' reads as Partial (a likely-but-unconfirmed match); the
// DS 'email only' state isn't surfaced by the digest model yet (HOR-364).
function identityFor(identity: SignalIdentity): { identityLabel: string; isUnknown: boolean } {
  switch (identity) {
    case 'known':
      return { identityLabel: 'Known', isUnknown: false }
    case 'probable':
      return { identityLabel: 'Partial', isUnknown: false }
    default:
      return { identityLabel: 'Unknown', isUnknown: true }
  }
}

// Compact recency for the Stream timestamp: ≤24h reads by the hour/minute
// (rendered live-green by TimeStamp), older as a plain day interval. Falls
// back to the verbose `timing` string when there's no raw last-seen.
function formatRecency(iso: string | null | undefined): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const diffMs = Date.now() - then
  if (diffMs < 60_000) return 'just now'
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function toStreamCardData(signal: DigestSignal): StreamCardData {
  return {
    contactId: signal.contactId,
    name: signal.name,
    initials: signal.initials,
    ...identityFor(signal.identity),
    tier: streamTierFor(signal),
    observation: signal.insight,
    place: signal.suburb,
    when: formatRecency(signal.lastSeenAt) ?? signal.timing,
    role: signal.role,
    property: signal.property,
  }
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
            <Stream signals={model.signals} />
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
  // Mirrors DigestViewModel.isDemo — the body uses `isDemo === 'preview'`
  // so the union must be preserved here, not narrowed to boolean.
  isDemo?: boolean | 'demo' | 'preview'
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
        <button
          type="button"
          onClick={() => openCompanion({ contextLabel: `On your activity · ${dateLabel}` })}
          style={askPillStyle}
        >
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

function Stream({ signals }: { signals: DigestSignal[] }) {
  const { openCompanion } = useCompanion()
  const { openComposer } = useComposerDock()
  const router = useRouter()

  // Optimistic Clear state. POST writes to `dismissed_signals` on the
  // server; the row is excluded next render. Local set hides the card
  // immediately + drives the counter + lets Undo restore without a
  // round-trip. Demo cards never get a Clear handler so they never enter.
  const [clearedIds, setClearedIds] = useState<Set<string>>(new Set())
  // Single-shot Undo (Gmail-style) — only the most-recent clear is
  // restorable. Subsequent clears replace this; the previous clear stays
  // cleared. Keeping a queue is more code than the v1 spec asks for.
  const [undoTarget, setUndoTarget] = useState<{ id: string; name: string } | null>(null)
  // Whether the agent cleared anything this session. Drives the
  // cleared-day state copy — distinct from a naturally-quiet day, which
  // the page renders before this component ever mounts.
  const [clearedAny, setClearedAny] = useState(false)

  // Auto-dismiss the Undo toast after ~8s so it never lingers past
  // working memory. A new clear resets the timer.
  useEffect(() => {
    if (!undoTarget) return
    const t = setTimeout(() => setUndoTarget(null), 8000)
    return () => clearTimeout(t)
  }, [undoTarget])

  const handleClear = useCallback(
    async (data: StreamCardData) => {
      setClearedIds((prev) => {
        const next = new Set(prev)
        next.add(data.contactId)
        return next
      })
      setUndoTarget({ id: data.contactId, name: data.name })
      setClearedAny(true)
      // Demo cards (SAMPLE DATA / ?demo=1) never persist — their
      // contactId is `demo-…`, not a real UUID, so the route would 422.
      // The optimistic hide IS the affordance for sample-data preview.
      if (data.contactId.startsWith('demo-')) return
      try {
        const res = await fetch('/api/stream/clear', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contactId: data.contactId }),
        })
        if (!res.ok) throw new Error(`clear_failed_${res.status}`)
      } catch (err) {
        // Roll back the optimistic hide so the card returns and the
        // agent isn't left thinking they've cleared something that
        // didn't persist. Best-effort logging — no user toast for the
        // failure case yet (the optimistic restore IS the feedback).
        console.error('[stream/clear] POST failed:', err)
        setClearedIds((prev) => {
          const next = new Set(prev)
          next.delete(data.contactId)
          return next
        })
        setUndoTarget(null)
      }
    },
    [],
  )

  const handleUndo = useCallback(async () => {
    const target = undoTarget
    if (!target) return
    setUndoTarget(null)
    setClearedIds((prev) => {
      const next = new Set(prev)
      next.delete(target.id)
      return next
    })
    // Mirror handleClear: demo cards never hit the server, so undo
    // is pure UI too.
    if (target.id.startsWith('demo-')) return
    try {
      const res = await fetch('/api/stream/clear', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contactId: target.id }),
      })
      if (!res.ok) throw new Error(`unclear_failed_${res.status}`)
    } catch (err) {
      // The optimistic restore already brought the card back; the
      // server still has the row, which means a refresh would re-hide
      // it. Surfacing this honestly would need a real toast lib (none
      // installed yet); for v1, log + accept the small inconsistency.
      console.error('[stream/clear] DELETE failed:', err)
    }
  }, [undoTarget])

  // Resolve each signal's Stream tier once, then group/suppress on it.
  const tiered = signals
    .filter((s) => !clearedIds.has(s.contactId))
    .map((s) => ({ signal: s, tier: streamTierFor(s) }))

  // Quiet cards are dashboard residue on a busy day — suppress them when
  // there's real work in the stream. They stand alone only on a quiet day (§4).
  const hasRealWork = tiered.some((t) => t.tier !== 'quiet')
  const visible = hasRealWork ? tiered.filter((t) => t.tier !== 'quiet') : tiered

  // Volume of signals to clear. Drops as the agent clears.
  const workable = visible.filter((t) => isWorkableSignal(t.signal)).length

  const groups = STREAM_TIER_ORDER.map((tier) => ({
    tier,
    items: visible.filter((t) => t.tier === tier).map((t) => t.signal),
  })).filter((g) => g.items.length > 0)

  // Ask Horace → read-context Companion (reuses the Phase 1 focused entry).
  const askAbout = (s: DigestSignal) => {
    const contextLabel =
      s.name && s.name !== 'A contact' ? `On ${s.name}` : s.suburb ? `On ${s.suburb}` : 'On this signal'
    openCompanion({
      contextLabel,
      signal: { contactId: s.contactId, name: s.name, read: s.read, identity: s.identity, suburb: s.suburb },
    })
  }

  return (
    <>
      {/* Section heading — "Stream" + the signal counter */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#5E5246', letterSpacing: '0.01em' }}>Stream</span>
        {workable > 0 ? (
          <span style={counterLiveStyle}>
            <span style={counterDotStyle} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 500 }}>{workable}</span> to clear
          </span>
        ) : (
          <span style={counterClearStyle}>
            <Check style={{ width: 13, height: 13 }} aria-hidden /> All clear
          </span>
        )}
      </div>

      {/* Cleared-day state (emotional payoff). Only fires when the agent
        * cleared their way down to zero this session — a naturally-quiet
        * day is handled by EmptyState before Stream mounts.
        * TODO(voice review): copy is the spec's draft, sign-off needed
        * before this ships. */}
      {visible.length === 0 && clearedAny ? (
        <ClearedDayState />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {groups.map((g) => (
            <div key={g.tier} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {groups.length > 1 && (
                <div style={{ fontSize: 11.5, fontWeight: 600, color: '#9C4A1F', letterSpacing: '0.01em' }}>
                  {STREAM_TIER_LABEL[g.tier]}
                </div>
              )}
              {g.items.map((s) => (
                <StreamCardMini
                  key={s.contactId}
                  data={toStreamCardData(s)}
                  onAsk={() => askAbout(s)}
                  // Whole-card affordance → contact record (HOR-343). Demo cards
                  // have no real contact page, so they stay non-clickable.
                  onOpen={
                    s.contactId.startsWith('demo-')
                      ? undefined
                      : () => router.push(`/contacts/${s.contactId}`)
                  }
                  // Email → composer dock (HOR-361). The dock resolves the
                  // recipient from the contact; we pass the signal as context.
                  onEmail={
                    s.contactId.startsWith('demo-')
                      ? undefined
                      : () =>
                          openComposer({
                            contactId: s.contactId,
                            contactName: s.name && s.name !== 'A contact' ? s.name : undefined,
                            source: 'stream',
                            signalContext: { label: s.insight, detail: s.suburb ?? undefined },
                          })
                  }
                  // Clear — every card, including demo. Demo cards branch
                  // inside handleClear to skip the round-trip.
                  onClear={handleClear}
                />
              ))}
            </div>
          ))}
        </div>
      )}

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

      {/* Single-shot Undo toast, bottom-pinned. Most-recent clear only. */}
      {undoTarget && <UndoToast name={undoTarget.name} onUndo={handleUndo} />}
    </>
  )
}

// ── Cleared-day state — the emotional payoff of clearing the stream ─────────
function ClearedDayState() {
  return (
    <div
      style={{
        padding: '22px 24px',
        background: '#FAF7F2',
        border: '1px solid rgba(61,82,70,0.18)',
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
        <p
          className="horace-nudge"
          style={{ margin: 0, fontSize: 16, lineHeight: 1.65, color: '#1A1612' }}
        >
          That&rsquo;s the street clear for today. I&rsquo;m still watching —
          I&rsquo;ll tap you if something stirs.
        </p>
      </div>
    </div>
  )
}

// ── Undo toast — bottom-pinned, ~8s, single-shot ────────────────────────────
function UndoToast({ name, onUndo }: { name: string; onUndo: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 14px 10px 16px',
        background: '#2E2823',
        color: '#FBF4EE',
        borderRadius: 10,
        boxShadow: '0 8px 24px rgba(26,22,18,0.22)',
        fontFamily: 'var(--font-body)',
        fontSize: 13.5,
        zIndex: 60,
        maxWidth: '92vw',
      }}
    >
      <span style={{ opacity: 0.92 }}>
        Cleared <span style={{ opacity: 0.75 }}>· {name}</span>
      </span>
      <button
        type="button"
        onClick={onUndo}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#F5D5BC',
          fontWeight: 600,
          fontSize: 13.5,
          cursor: 'pointer',
          padding: '4px 6px',
          fontFamily: 'inherit',
        }}
      >
        Undo
      </button>
    </div>
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
