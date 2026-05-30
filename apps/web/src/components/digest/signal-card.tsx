'use client'

/**
 * Horace — Digest V2 signal card ("Activity & Signals").
 *
 * Anatomy (top → bottom), per the engineering handoff (§4):
 *   1. Tier pill (urgency) left  +  identity chip & contextual Ask right
 *   2. Identity block — avatar (its style encodes identity state) + name + status
 *   3. Insight — what they did, plain, AGENT-FACING (behaviour OK here)
 *   4. The read — Horace's voice, italic. Hands over the pretext, not the watch.
 *   5. Action — degrades gracefully with identity (draft → confirm → watch → none)
 *   6. Outcome loop — known contacts only
 *
 * THE FIREWALL (§5, hard rule): the draft's trust line states the clean
 * `pretext` (allowed_pretext) plainly — it must NEVER read `read` or
 * `insight`. Outbound copy leans on a public/relationship hook, never on
 * what the visitor did on the site.
 */

import Link from 'next/link'
import { useCallback, useState } from 'react'
import {
  UserRound,
  HelpCircle,
  Eye,
  MapPin,
  PenLine,
  ShieldCheck,
  Send,
  Check,
  Clock,
  Coffee,
  Sparkles,
  Feather,
} from 'lucide-react'
import { useCompanion } from '@/components/companion/companion-context'
import { INTENT_AVATAR_BG, type IntentLevel } from '@/lib/design/intent'

// ── Data contract ─────────────────────────────────────────────────────────────

export type SignalIdentity = 'known' | 'probable' | 'anonymous' | 'ambient'
export type SignalTier = 'act-now' | 'worth-a-look' | 'ambient'

/** One step in the Sent → Opened → Replied outcome loop. */
export type OutcomeStep = 'sent' | 'opened' | 'clicked' | 'replied' | 'quiet' | 'new'

export interface SignalDraft {
  subject: string
  body: string
}

export interface SignalOutcome {
  /** Ordered loop steps. A leading `'new'` marks a first-ever thread. */
  steps: OutcomeStep[]
  /** Short Horace-voiced note under the steps (the "memory"). */
  note: string
}

export interface DigestSignal {
  contactId: string
  name: string
  /** Initials for the known avatar. Null for anonymous/ambient. */
  initials: string | null
  /** Suburb or area string — e.g. "Paddington, NSW". Optional. */
  suburb: string | null
  /** Pre-computed time-ago string ("Active 2h ago", "Yesterday"…). */
  timing: string
  /** How confidently Horace knows this visitor — drives the whole card. */
  identity: SignalIdentity
  /** Urgency tier — drives grouping + Send emphasis. */
  tier: SignalTier
  /** Avatar fill for known contacts. Defaults to 'none' when absent. */
  intent?: IntentLevel
  /** Probable-match confidence (0–1). Renders as "NN%" on the chip. */
  confidence?: number
  /** Newly anonymous→known — adds a small sparkle on the avatar. */
  newlyKnown?: boolean
  /** Agent-facing behaviour summary. May name what they did on the site. */
  insight: string
  /** Horace's voice, italic. Hands over the pretext, never the surveillance. */
  read: string
  /** FIREWALL: the public/relationship hook. The ONLY thing the trust line reads. */
  pretext?: string
  /** Ready-to-send draft (known only). Absent → no draft block (§5). */
  draft?: SignalDraft
  /** Sent → Opened → Replied history (known only). */
  outcome?: SignalOutcome
}

/**
 * A signal is "workable" — i.e. it asks the agent for a decision and is
 * counted by the live Stream counter — when it isn't ambient and has an
 * action surface. A known contact with no draft yet (live, pre-draft-gen)
 * is informational, not workable.
 */
export function isWorkableSignal(s: DigestSignal): boolean {
  if (s.tier === 'ambient' || s.identity === 'ambient') return false
  if (s.identity === 'known') return Boolean(s.draft)
  return true
}

interface SignalCardProps {
  signal: DigestSignal
  /** Called once at the card's terminal decision (Send / Skip / decline / watch). */
  onClear?: (id: string) => void
}

// ── Tier pill ───────────────────────────────────────────────────────────────

const TIER_PILL: Record<SignalTier, { label: string; fg: string; bg: string; dot: string }> = {
  'act-now':      { label: 'Act now',      fg: '#9C4A1F', bg: 'rgba(196,98,45,0.14)', dot: '#C4622D' },
  'worth-a-look': { label: 'Worth a look', fg: '#5E5246', bg: 'rgba(140,123,107,0.14)', dot: '#8C7B6B' },
  'ambient':      { label: 'Ambient',      fg: '#3D5246', bg: 'rgba(61,82,70,0.12)',  dot: '#3D5246' },
}

function TierPill({ tier }: { tier: SignalTier }) {
  const m = TIER_PILL[tier]
  return (
    <span style={{ ...s.tierPill, color: m.fg, background: m.bg }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.dot, flexShrink: 0 }} />
      {m.label}
    </span>
  )
}

// ── Identity chip (top-right) ─────────────────────────────────────────────────

function IdentityChip({ identity, confidence }: { identity: SignalIdentity; confidence?: number }) {
  const map = {
    known:     { Icon: UserRound, label: 'Known' },
    probable:  { Icon: HelpCircle, label: `Probable match · ${Math.round((confidence ?? 0) * 100)}%` },
    anonymous: { Icon: Eye, label: 'Anonymous' },
    ambient:   { Icon: MapPin, label: 'Suburb signal' },
  }[identity]
  const Icon = map.Icon
  return (
    <span style={s.idChip}>
      <Icon style={{ width: 12, height: 12 }} aria-hidden />
      {map.label}
    </span>
  )
}

// ── Avatar — encodes identity state ───────────────────────────────────────────

function Avatar({ signal }: { signal: DigestSignal }) {
  const { identity, intent, initials, newlyKnown } = signal
  if (identity === 'known') {
    return (
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{ ...s.avatar, background: INTENT_AVATAR_BG[intent ?? 'none'], color: '#FAF7F2' }}>
          {initials}
        </div>
        {newlyKnown && (
          <span style={s.newDot}>
            <Sparkles style={{ width: 10, height: 10 }} aria-hidden />
          </span>
        )}
      </div>
    )
  }
  if (identity === 'probable') {
    return <div style={{ ...s.avatar, ...s.avatarDashed, color: '#8C7B6B' }}>?</div>
  }
  if (identity === 'anonymous') {
    return (
      <div style={{ ...s.avatar, ...s.avatarDashed, color: 'rgba(140,123,107,0.7)' }}>
        <UserRound style={{ width: 20, height: 20 }} aria-hidden />
      </div>
    )
  }
  return (
    <div style={{ ...s.avatar, background: 'rgba(61,82,70,0.1)', color: '#3D5246' }}>
      <MapPin style={{ width: 18, height: 18 }} aria-hidden />
    </div>
  )
}

// ── Outcome loop (known only) ─────────────────────────────────────────────────

const STEP_LABEL: Record<OutcomeStep, string> = {
  sent: 'Sent', opened: 'Opened', clicked: 'Clicked', replied: 'Replied', quiet: 'No reply', new: 'New thread',
}

function OutcomeLoop({ outcome, justSent }: { outcome?: SignalOutcome; justSent: boolean }) {
  if (justSent) {
    return (
      <div style={s.outcome}>
        <div style={s.steps}>
          <StepDot label="Sent just now" state="active" />
          <Bar />
          <StepDot label="Opened" state="pending" />
          <Bar />
          <StepDot label="Reply" state="pending" />
        </div>
        <p style={s.outNote}>
          Away it goes — I&rsquo;m watching for the open. I&rsquo;ll sharpen the next one based on how this lands.
        </p>
      </div>
    )
  }
  if (!outcome) return null
  if (outcome.steps[0] === 'new') {
    return (
      <div style={s.outcome}>
        <div style={s.steps}>
          <StepDot label="New thread" state="new" />
          <Bar dim />
          <StepDot label="Opened" state="pending" />
          <Bar dim />
          <StepDot label="Reply" state="pending" />
        </div>
        <p style={s.outNote}>{outcome.note}</p>
      </div>
    )
  }
  return (
    <div style={s.outcome}>
      <div style={s.steps}>
        {outcome.steps.map((step, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
            {i > 0 && <Bar dim={step === 'quiet'} />}
            <StepDot label={STEP_LABEL[step]} state={step === 'quiet' ? 'quiet' : 'done'} />
          </span>
        ))}
      </div>
      <p style={s.outNote}>{outcome.note}</p>
    </div>
  )
}

type StepState = 'done' | 'active' | 'quiet' | 'pending' | 'new'

function StepDot({ label, state }: { label: string; state: StepState }) {
  const dot: Record<StepState, { background: string; border: string }> = {
    done:    { background: '#3D5246', border: '#3D5246' },
    active:  { background: '#C4622D', border: '#C4622D' },
    quiet:   { background: 'transparent', border: 'rgba(140,123,107,0.5)' },
    pending: { background: 'transparent', border: 'rgba(140,123,107,0.3)' },
    new:     { background: '#C4622D', border: '#C4622D' },
  }
  return (
    <span style={s.step}>
      <span
        style={{
          ...s.stepDot,
          background: dot[state].background,
          borderColor: dot[state].border,
          animation: state === 'active' ? 'pulseDot 1.6s ease-out infinite' : 'none',
        }}
      />
      <span style={{ ...s.stepLabel, color: state === 'pending' ? 'rgba(140,123,107,0.65)' : '#5E5246' }}>
        {label}
      </span>
    </span>
  )
}

function Bar({ dim }: { dim?: boolean }) {
  return <span style={{ ...s.bar, background: dim ? 'rgba(140,123,107,0.2)' : 'rgba(61,82,70,0.4)' }} />
}

// ── Draft block (known) ───────────────────────────────────────────────────────

function DraftBlock({
  signal,
  accent,
  onSend,
  onSkip,
}: {
  signal: DigestSignal
  accent: string
  onSend: () => void
  onSkip: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(signal.draft?.body ?? '')
  const first = signal.name.split(' ')[0]
  // FIREWALL: the trust line states the clean PRETEXT plainly — never `read`
  // or `insight`. If a pretext can't be justified, there is no draft (§5).
  const pretext = signal.pretext ?? 'a public hook'

  return (
    <div style={s.draft}>
      <div style={s.draftHead}>
        <span style={s.draftEyebrow}>
          <PenLine style={{ width: 12, height: 12 }} aria-hidden /> Draft ready to send
        </span>
        <span style={s.draftTo}>To {first}</span>
      </div>
      <div style={s.draftSubject}>{signal.draft?.subject}</div>
      {editing ? (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          style={s.draftTextarea}
          rows={7}
        />
      ) : (
        <p style={s.draftBody}>{body}</p>
      )}
      <div style={s.pretext}>
        <ShieldCheck style={{ width: 12, height: 12, color: '#3D5246', flexShrink: 0 }} aria-hidden />
        Reasoned from {pretext} — not from anything {first} did on your site.
      </div>
      <div style={s.acts}>
        <button type="button" style={{ ...s.btn, ...s.btnPrimary, background: accent, borderColor: accent }} onClick={onSend}>
          <Send style={{ width: 14, height: 14 }} aria-hidden /> Send
        </button>
        <button type="button" style={{ ...s.btn, ...s.btnGhost }} onClick={() => setEditing((e) => !e)}>
          <PenLine style={{ width: 13, height: 13 }} aria-hidden /> {editing ? 'Done' : 'Edit'}
        </button>
        <button type="button" style={{ ...s.btn, ...s.btnGhost, color: '#8C7B6B' }} onClick={onSkip}>
          Skip
        </button>
      </div>
    </div>
  )
}

// ── Main card ─────────────────────────────────────────────────────────────────

export function SignalCard({ signal, onClear }: SignalCardProps) {
  const { openCompanion } = useCompanion()
  const [confirmed, setConfirmed] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [sent, setSent] = useState(false)
  const [skipped, setSkipped] = useState(false)
  const [watching, setWatching] = useState(false)

  const isDemo = signal.contactId.startsWith('demo-')
  const first = signal.name.split(' ')[0]

  // Persist a decision to the dismiss API for real (non-demo) signals. The
  // counter clears locally regardless. Send wiring to /api/email/send lands
  // in Phase 2 — for now Send is an optimistic justSent transition.
  const persistDismiss = useCallback(
    (reason: string) => {
      if (isDemo) return
      void fetch('/api/companion/dismiss', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: `digest:contact:${signal.contactId}`, reason }),
      }).catch((err) => console.warn('[signal-card] dismiss failed:', err))
    },
    [isDemo, signal.contactId],
  )

  // A signal clears on a DECISION — Send or Skip on a draft, confirm-decline,
  // or a choice to watch. Confirming a probable only REVEALS the draft (not
  // terminal) — it doesn't clear until that draft is acted on (§3).
  const clear = useCallback(() => onClear?.(signal.contactId), [onClear, signal.contactId])
  const onSend = () => { setSent(true); clear() }
  const onSkip = () => { setSkipped(true); persistDismiss('digest-skip'); clear() }
  const onDecline = () => { setDeclined(true); persistDismiss('digest-decline'); clear() }
  const onWatch = () => { setWatching(true); persistDismiss('digest-watch'); clear() }

  function askAbout() {
    const named = signal.identity === 'known' || signal.identity === 'probable'
    if (named) {
      openCompanion({ prompt: `Why is ${signal.name} on my digest today?`, contextLabel: `Contact: ${signal.name}` })
    } else {
      openCompanion({ prompt: `What's behind the ${signal.suburb ?? 'this'} signal?`, contextLabel: 'Digest' })
    }
  }

  // Effective identity: a confirmed probable becomes known; a declined one is
  // held anonymous (auto-confirm: no — a wrong warm email costs more).
  const isKnown = signal.identity === 'known' || (signal.identity === 'probable' && confirmed)
  const accent = signal.tier === 'act-now' ? '#C4622D' : '#1A1612'
  const displayChip: SignalIdentity = isKnown && signal.identity === 'probable' ? 'known' : signal.identity
  const avatarSignal = isKnown && signal.identity === 'probable' ? { ...signal, identity: 'known' as const } : signal

  return (
    <article
      style={{
        ...s.card,
        ...(signal.tier === 'act-now' ? s.cardActNow : {}),
        ...(signal.tier === 'ambient' ? s.cardAmbient : {}),
      }}
    >
      {/* 1. Top row — tier pill + identity state & contextual Ask */}
      <div style={s.topRow}>
        <TierPill tier={signal.tier} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <IdentityChip identity={displayChip} confidence={signal.confidence} />
          <button
            type="button"
            style={s.askChip}
            title={`Ask Horace about ${first}`}
            aria-label={`Ask Horace about ${first}`}
            onClick={askAbout}
          >
            <Feather style={{ width: 12, height: 12 }} aria-hidden /> Ask
          </button>
        </div>
      </div>

      {/* 2. Identity block */}
      <div style={s.identity}>
        <Avatar signal={avatarSignal} />
        <div style={{ minWidth: 0 }}>
          {isKnown ? (
            <Link href={`/contacts/${signal.contactId}`} style={s.nameLink}>
              {signal.name}
            </Link>
          ) : (
            <div style={s.name}>{signal.name}</div>
          )}
          <div style={s.status}>
            {signal.suburb ? <>{signal.suburb} · </> : null}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{signal.timing}</span>
          </div>
        </div>
      </div>

      {/* 3. Insight — plain, agent-facing */}
      <p style={s.insight}>{signal.insight}</p>

      {/* 4. The read — Horace's voice */}
      <p style={s.read}>{signal.read}</p>

      {/* 5. Action — degrades with identity */}
      {isKnown && signal.draft && !sent && !skipped && (
        <DraftBlock signal={signal} accent={accent} onSend={onSend} onSkip={onSkip} />
      )}
      {isKnown && skipped && (
        <div style={s.watchState}>
          <Clock style={{ width: 14, height: 14, color: '#8C7B6B' }} aria-hidden />
          Skipped for now — I&rsquo;ll hold off and bring {first} back if the next move warrants it.
        </div>
      )}

      {signal.identity === 'probable' && !confirmed && !declined && (
        <div style={s.confirm}>
          <span style={s.confirmQ}>Is this {signal.name}?</span>
          <div style={s.acts}>
            <button
              type="button"
              style={{ ...s.btn, ...s.btnPrimary, background: '#1A1612', borderColor: '#1A1612' }}
              onClick={() => setConfirmed(true)}
            >
              <Check style={{ width: 14, height: 14 }} aria-hidden /> Confirm it&rsquo;s {first}
            </button>
            <button type="button" style={{ ...s.btn, ...s.btnGhost }} onClick={onDecline}>
              Not {first}
            </button>
          </div>
        </div>
      )}
      {signal.identity === 'probable' && declined && (
        <div style={s.watchState}>
          <Eye style={{ width: 14, height: 14, color: '#8C7B6B' }} aria-hidden />
          Kept anonymous — I&rsquo;ll keep watching and only flag a name when I&rsquo;m sure.
        </div>
      )}

      {signal.identity === 'anonymous' &&
        (watching ? (
          <div style={s.watchState}>
            <Check style={{ width: 14, height: 14, color: '#3D5246' }} aria-hidden />
            Watching closely — I&rsquo;ll surface them the moment they&rsquo;re known.
          </div>
        ) : (
          <div style={s.acts}>
            <button type="button" style={{ ...s.btn, ...s.btnSecondary }} onClick={onWatch}>
              <Eye style={{ width: 14, height: 14 }} aria-hidden /> Watch closely
            </button>
          </div>
        ))}

      {signal.identity === 'ambient' && (
        <div style={s.ambientNote}>
          <Coffee style={{ width: 13, height: 13, color: '#8C7B6B' }} aria-hidden />
          Nothing to do — just so you know.
        </div>
      )}

      {/* 6. Outcome loop — known only */}
      {isKnown && <OutcomeLoop outcome={signal.outcome} justSent={sent} />}
    </article>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  card: {
    background: '#FAF7F2',
    border: '1px solid rgba(140,123,107,0.2)',
    borderRadius: 12,
    padding: '18px 20px 16px',
    boxShadow: '0 1px 3px rgba(26,22,18,0.06)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  cardActNow: {
    background: 'linear-gradient(180deg, rgba(196,98,45,0.07) 0%, #FAF7F2 60%)',
    border: '1px solid rgba(196,98,45,0.24)',
    boxShadow: '0 2px 10px rgba(196,98,45,0.08)',
  },
  cardAmbient: { background: '#F7F4ED', border: '1px solid rgba(140,123,107,0.18)', boxShadow: 'none' },

  topRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  tierPill: {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 9999,
    fontSize: 11.5, fontWeight: 600, letterSpacing: '0.01em', lineHeight: 1,
  },
  idChip: {
    display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 500,
    color: '#8C7B6B', fontFamily: 'var(--font-body)',
  },
  askChip: {
    display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 500, color: '#8C7B6B',
    background: 'transparent', border: '1px solid rgba(140,123,107,0.28)', borderRadius: 9999,
    padding: '4px 10px', cursor: 'pointer', fontFamily: 'var(--font-body)', lineHeight: 1,
    transition: 'all 160ms var(--ease-out)',
  },

  identity: { display: 'flex', alignItems: 'center', gap: 13 },
  avatar: {
    width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: 14, fontWeight: 600, flexShrink: 0, fontFamily: 'var(--font-body)',
  },
  avatarDashed: { background: 'transparent', border: '1.5px dashed rgba(140,123,107,0.55)' },
  newDot: {
    position: 'absolute', right: -3, bottom: -3, width: 18, height: 18, borderRadius: '50%',
    background: '#C4622D', color: '#FAF7F2', display: 'flex', alignItems: 'center',
    justifyContent: 'center', border: '2px solid #FAF7F2',
  },
  name: { fontSize: 15.5, fontWeight: 600, color: '#1A1612', lineHeight: 1.25 },
  nameLink: {
    fontSize: 15.5, fontWeight: 600, color: '#1A1612', lineHeight: 1.25,
    textDecoration: 'none',
  },
  status: { fontSize: 12, color: '#8C7B6B', marginTop: 2 },

  insight: { margin: 0, fontSize: 13.5, lineHeight: 1.5, color: '#2E2823' },
  read: { margin: 0, fontStyle: 'italic', fontSize: 15, lineHeight: 1.55, color: '#4A4038', fontFamily: 'var(--font-body)' },

  draft: { marginTop: 2, background: 'rgba(140,123,107,0.06)', border: '1px solid rgba(140,123,107,0.18)', borderRadius: 9, padding: '13px 14px' },
  draftHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  draftEyebrow: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em', color: '#9C4A1F' },
  draftTo: { fontSize: 11, color: '#8C7B6B', fontFamily: 'var(--font-mono)' },
  draftSubject: { fontSize: 13.5, fontWeight: 600, color: '#1A1612', marginBottom: 6 },
  draftBody: { margin: 0, fontSize: 12.5, lineHeight: 1.6, color: '#4A4038', whiteSpace: 'pre-line' },
  draftTextarea: {
    width: '100%', fontSize: 12.5, lineHeight: 1.6, color: '#2E2823', fontFamily: 'var(--font-body)',
    background: '#FAF7F2', border: '1px solid rgba(140,123,107,0.3)', borderRadius: 6, padding: '8px 10px', resize: 'vertical',
  },
  pretext: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 11, color: '#3D5246', lineHeight: 1.4 },
  acts: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' },

  btn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '8px 15px',
    borderRadius: 7, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-body)',
    border: '1px solid transparent', transition: 'all 180ms var(--ease-out)', lineHeight: 1,
  },
  btnPrimary: { color: '#FAF7F2' },
  btnSecondary: { background: '#FAF7F2', color: '#1A1612', border: '1px solid rgba(140,123,107,0.35)' },
  btnGhost: { background: 'transparent', color: '#5E5246' },

  confirm: { marginTop: 2, background: 'rgba(140,123,107,0.06)', border: '1px dashed rgba(140,123,107,0.35)', borderRadius: 9, padding: '13px 14px' },
  confirmQ: { fontSize: 13, fontWeight: 600, color: '#1A1612' },

  watchState: {
    display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#5E5246', fontStyle: 'italic',
    background: 'rgba(61,82,70,0.06)', borderRadius: 8, padding: '10px 12px', lineHeight: 1.45,
  },
  ambientNote: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#8C7B6B', fontStyle: 'italic' },

  outcome: { marginTop: 4, paddingTop: 12, borderTop: '1px solid rgba(140,123,107,0.16)' },
  steps: { display: 'flex', alignItems: 'center', marginBottom: 7 },
  step: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  stepDot: { width: 9, height: 9, borderRadius: '50%', border: '1.5px solid', flexShrink: 0 },
  stepLabel: { fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap' },
  bar: { width: 22, height: 1.5, margin: '0 8px', flexShrink: 0 },
  outNote: { margin: 0, fontSize: 11.5, color: '#8C7B6B', fontStyle: 'italic', lineHeight: 1.45 },
} satisfies Record<string, React.CSSProperties>
