/**
 * HoraceReadCard — the authored, sourced "Why now" card (HOR-246 amendment).
 *
 * Promotes Horace's read from an inline label+paragraph into a first-class
 * carded object: a Horace mark, the read, a provenance footer ("Auto · from
 * your data" + what it was built from), and an "Ask a follow-up" entry into
 * the Companion in *read* context. The "what changed" chips (the evidence
 * behind the read) and the Stream deep-link sit beneath the card.
 *
 * Built as a shared component so the Contact and Property detail screens render
 * the same object — only the surrounding zone differs. Contact wires it today;
 * Property gains a read pipeline in a follow-up (it has no `nudge` source yet).
 */
import { Zap, TrendingUp, Sun, ArrowUpRight, Repeat, Eye, Pencil, Mail, Clock } from 'lucide-react'
import { QuillIcon } from '@/components/ui/quill-icon'
import type { ChangeChip, ChipIcon } from '@/lib/contacts/signal-summary'

const CHIP_ICON: Record<ChipIcon, typeof Repeat> = {
  repeat: Repeat,
  eye:    Eye,
  pen:    Pencil,
  mail:   Mail,
  clock:  Clock,
}

export interface HoraceReadCardProps {
  /** The read paragraph (a contact's `nudge`). */
  read: string
  /** Freshness of the generated read, e.g. "2h ago". Omitted when unknown. */
  updated?: string | null
  /** Provenance line, e.g. "Built from 3 sessions + an appraisal form this week". */
  builtFrom?: string | null
  /** Behaviour chips — the evidence behind the read. */
  changes?: ChangeChip[]
  /** Tier colour tinting the chip icons. */
  chipColor?: string
  /** Stream deep-link target + label. Both required to render the row. */
  streamHref?: string | null
  streamWhen?: string | null
  /** Opens the Companion in read context (not the edit form). */
  onAsk: () => void
  compact?: boolean
}

export function HoraceMark({ size = 28 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#C4622D',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
      aria-hidden
    >
      <span className="font-display" style={{ fontWeight: 600, fontSize: size * 0.5, color: '#FAF7F2', lineHeight: 1 }}>
        H
      </span>
    </div>
  )
}

export function HoraceReadCard({
  read,
  updated,
  builtFrom,
  changes = [],
  chipColor = '#C4622D',
  streamHref,
  streamWhen,
  onAsk,
  compact = false,
}: HoraceReadCardProps) {
  return (
    <div>
      {/* WHY NOW — section label + hairline rule */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: '#C4622D',
          }}
        >
          <Zap style={{ width: 13, height: 13 }} /> Why now
        </span>
        <div style={{ flex: 1, height: 1, background: 'rgba(140,123,107,0.14)' }} />
      </div>

      {/* the read — an authored, sourced object */}
      <div
        style={{
          background: '#FAF7F2',
          border: '1px solid rgba(140,123,107,0.2)',
          borderRadius: 12,
          padding: compact ? '15px 16px 13px' : '18px 20px 14px',
          boxShadow: '0 1px 3px rgba(26,22,18,0.05)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <HoraceMark />
          <span style={{ fontWeight: 600, fontSize: 14.5, color: '#1A1612' }}>Horace&rsquo;s read</span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              fontWeight: 500,
              padding: '3px 9px',
              borderRadius: 9999,
              background: 'rgba(140,123,107,0.1)',
              color: '#8C7B6B',
            }}
          >
            <Zap style={{ width: 11, height: 11 }} /> Auto · from your data
          </span>
          {updated && (
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#8C7B6B', fontFamily: 'var(--font-mono)' }}>
              updated {updated}
            </span>
          )}
        </div>

        <p style={{ margin: 0, fontSize: compact ? 15 : 16.5, lineHeight: 1.55, color: '#2E2823', textWrap: 'pretty' }}>
          {read}
        </p>

        <div style={{ height: 1, background: 'rgba(140,123,107,0.14)', margin: '14px 0 0' }} />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            paddingTop: 11,
            flexWrap: 'wrap',
          }}
        >
          {builtFrom && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8C7B6B' }}>
              <TrendingUp style={{ width: 13, height: 13 }} /> {builtFrom}
            </span>
          )}
          <button
            type="button"
            onClick={onAsk}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12.5,
              fontWeight: 600,
              color: '#C4622D',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              marginLeft: 'auto',
              fontFamily: 'var(--font-body)',
            }}
          >
            <QuillIcon style={{ width: 13, height: 13 }} /> Ask a follow-up
          </button>
        </div>
      </div>

      {/* what changed — the evidence behind the read (white pills) */}
      {changes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
          {changes.map((c, i) => {
            const Icon = CHIP_ICON[c.icon]
            return (
              <span
                key={i}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 11.5,
                  fontWeight: 500,
                  padding: '4px 10px',
                  borderRadius: 9999,
                  background: '#FFFFFF',
                  border: '1px solid rgba(140,123,107,0.2)',
                  color: '#5E5246',
                }}
              >
                <Icon style={{ width: 12, height: 12, color: chipColor }} /> {c.label}
              </span>
            )
          })}
        </div>
      )}

      {/* surfaced-in-Stream deep link */}
      {streamHref && streamWhen && (
        <a
          href={streamHref}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            fontWeight: 500,
            color: '#8C7B6B',
            textDecoration: 'none',
            marginTop: 12,
          }}
        >
          <Sun style={{ width: 13, height: 13, color: '#C4622D' }} /> Surfaced in your Stream · {streamWhen}
          <ArrowUpRight style={{ width: 12, height: 12, color: '#8C7B6B' }} />
        </a>
      )}
    </div>
  )
}
