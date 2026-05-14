'use client'

/**
 * MomentCard — one item in the notifications stream.
 *
 * Single anatomy shared by all five moment types (Newly known, High intent,
 * Returning, Worth watching, Ownership changed). Only the icon, headline,
 * primary action and accent change per type.
 *
 * Visual contract — ported from the approved design mock at
 * `/tmp/horace_notif_design/notification-stream.jsx` (lines 88–299).
 * Pixel values are intentional; do not refactor to Tailwind utilities
 * without comparing against the mock in a browser.
 */

import {
  ArrowUpRight,
  Check,
  Eye,
  Flame,
  Home,
  Key,
  Layers,
  MoreHorizontal,
  UserCheck,
  type LucideIcon,
} from 'lucide-react'
import { MOMENT_TONES, type MomentSubject, type MomentTone, type StreamMoment } from './moment-types'

const ICON_BY_TONE: Record<MomentTone['icon'], LucideIcon> = {
  'user-check':     UserCheck,
  'flame':          Flame,
  'arrow-up-right': ArrowUpRight,
  'eye':            Eye,
  'key':            Key,
}

export type StackStyle = 'flat' | 'literal'

export interface MomentCardProps {
  moment: StreamMoment
  /** When true, render the post-action confirmation pill in place of the primary CTA. */
  resolved?: boolean
  /** Primary action handler — fires when the agent taps the primary button. */
  onPrimary?: (moment: StreamMoment) => void
  /** Overflow menu trigger — fires when the agent taps the More button. */
  onMore?: (moment: StreamMoment) => void
  /** Whole-card tap handler — anything outside the action buttons. */
  onOpen?: (moment: StreamMoment) => void
  /** How a batched/stacked moment renders (flat chip vs literal offset cards). */
  stackStyle?: StackStyle
  /** Copy for the resolved confirmation pill, e.g. "Added to Warming up". */
  resolvedLabel?: string
}

export function MomentCard({
  moment,
  resolved = false,
  onPrimary,
  onMore,
  onOpen,
  stackStyle = 'flat',
  resolvedLabel = 'Added to Warming up',
}: MomentCardProps) {
  const tone = MOMENT_TONES[moment.type]
  const Icon = ICON_BY_TONE[tone.icon]
  const isRead = !moment.unread
  const isStack = !!moment.stack
  const literalStack = isStack && stackStyle === 'literal'

  const pad = 14

  return (
    <div style={literalStack ? { position: 'relative', paddingBottom: 8 } : { position: 'relative' }}>
      {/* Literal-stack ghost cards — peek behind the live card to read as a stack. */}
      {literalStack && (
        <>
          <div
            style={{
              position: 'absolute',
              left: 6,
              right: 6,
              top: 8,
              bottom: -2,
              background: '#FAF7F2',
              border: '1px solid rgba(140,123,107,0.18)',
              borderRadius: 10,
              zIndex: 0,
              boxShadow: '0 1px 2px rgba(26,22,18,0.04)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 3,
              right: 3,
              top: 4,
              bottom: 1,
              background: '#FAF7F2',
              border: '1px solid rgba(140,123,107,0.2)',
              borderRadius: 10,
              zIndex: 0,
              boxShadow: '0 1px 3px rgba(26,22,18,0.05)',
            }}
          />
        </>
      )}

      {/* Live card. Tapping anywhere outside the action buttons opens the subject. */}
      <div
        role={onOpen ? 'button' : undefined}
        tabIndex={onOpen ? 0 : undefined}
        onClick={onOpen ? () => onOpen(moment) : undefined}
        onKeyDown={
          onOpen
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpen(moment)
                }
              }
            : undefined
        }
        style={{
          position: 'relative',
          zIndex: 1,
          background: resolved ? 'rgba(61,82,70,0.04)' : '#FAF7F2',
          border: '1px solid ' + (resolved ? 'rgba(61,82,70,0.18)' : 'rgba(140,123,107,0.2)'),
          borderRadius: 10,
          padding: `${pad}px ${pad + 2}px ${pad - 2}px`,
          boxShadow: '0 1px 3px rgba(26,22,18,0.05)',
          opacity: isRead && !resolved ? 0.92 : 1,
          // Unread: a soft accent stripe on the left edge, in the type's ink.
          borderLeft: moment.unread ? `2px solid ${tone.ink}` : '1px solid rgba(140,123,107,0.2)',
          paddingLeft: moment.unread ? pad + 1 : pad + 2,
          cursor: onOpen ? 'pointer' : 'default',
          transition: 'box-shadow 180ms cubic-bezier(0.16,1,0.3,1), background 180ms',
        }}
      >
        {/* Top row: icon · headline · time-ago */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              flexShrink: 0,
              background: tone.dim,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: 1,
            }}
          >
            <Icon style={{ width: 13, height: 13, color: tone.ink, strokeWidth: 2 }} />
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 14,
              fontWeight: moment.unread ? 600 : 500,
              color: isRead ? '#2E2823' : '#1A1612',
              lineHeight: 1.4,
              letterSpacing: '-0.005em',
            }}
          >
            {moment.headline}
          </div>
          <div
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              color: '#8C7B6B',
              flexShrink: 0,
              marginTop: 3,
            }}
          >
            {moment.time}
          </div>
        </div>

        {/* Body: Horace's italic editorial read */}
        <div
          style={{
            paddingLeft: 32,
            fontFamily: "'Playfair Display', serif",
            fontStyle: 'italic',
            fontSize: 13,
            fontWeight: 400,
            lineHeight: 1.5,
            color: '#3D362E',
            marginBottom: moment.tags?.length ? 8 : 10,
          }}
        >
          {moment.editorial}
        </div>

        {/* Optional tag chips */}
        {moment.tags?.length > 0 && (
          <div
            style={{
              paddingLeft: 32,
              display: 'flex',
              gap: 5,
              flexWrap: 'wrap',
              marginBottom: 10,
            }}
          >
            {moment.tags.map((tag) => (
              <Tag key={tag} accent={tag === 'Newly identified'}>
                {tag}
              </Tag>
            ))}
          </div>
        )}

        {/* Stack chip — flat treatment (`+N more on this contact`) */}
        {isStack && !literalStack && moment.stack && (
          <div
            style={{
              paddingLeft: 32,
              marginBottom: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Layers style={{ width: 11, height: 11, color: '#8C7B6B', strokeWidth: 2 }} />
            <span style={{ fontSize: 11.5, color: '#8C7B6B', fontWeight: 500 }}>
              +{moment.stack.count} more {moment.stack.count === 1 ? 'moment' : 'moments'} on this{' '}
              {moment.subject.kind === 'property' ? 'property' : 'contact'}
            </span>
          </div>
        )}

        {/* Subject + actions row */}
        <div
          style={{
            marginLeft: 32,
            paddingTop: 10,
            borderTop: '1px solid rgba(140,123,107,0.12)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <SubjectAvatar subject={moment.subject} tone={tone} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: '#1A1612',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {moment.subject.kind === 'property' ? moment.subject.address : moment.subject.name}
            </div>
            <div
              style={{
                fontSize: 11,
                color: '#8C7B6B',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                marginTop: 1,
              }}
            >
              {moment.subject.context}
            </div>
          </div>

          {/* Actions — primary CTA (or resolved pill) + More overflow trigger. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {resolved ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: '#3D5246',
                  background: 'rgba(61,82,70,0.1)',
                  padding: '6px 10px',
                  borderRadius: 8,
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                <Check style={{ width: 12, height: 12, color: '#3D5246', strokeWidth: 2.5 }} />
                {resolvedLabel}
              </span>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onPrimary?.(moment)
                }}
                style={{
                  background: moment.unread ? '#C4622D' : 'transparent',
                  color: moment.unread ? '#FAF7F2' : '#C4622D',
                  border: moment.unread ? '1px solid #C4622D' : '1px solid rgba(196,98,45,0.35)',
                  borderRadius: 8,
                  padding: '6px 10px',
                  fontSize: 11.5,
                  fontWeight: 600,
                  fontFamily: "'DM Sans', sans-serif",
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  letterSpacing: '-0.005em',
                }}
              >
                {moment.primary}
              </button>
            )}
            <button
              type="button"
              aria-label="More"
              onClick={(e) => {
                e.stopPropagation()
                onMore?.(moment)
              }}
              style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#8C7B6B',
              }}
            >
              <MoreHorizontal style={{ width: 14, height: 14, strokeWidth: 2 }} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Tag({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: 9999,
        background: accent ? 'rgba(196,98,45,0.1)' : 'rgba(140,123,107,0.1)',
        color: accent ? '#C4622D' : '#5A4D40',
        fontSize: 11,
        fontWeight: 500,
        lineHeight: '18px',
      }}
    >
      {children}
    </span>
  )
}

function SubjectAvatar({ subject, tone }: { subject: MomentSubject; tone: MomentTone }) {
  const size = 28
  if (subject.kind === 'property') {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 6,
          flexShrink: 0,
          background: 'linear-gradient(135deg, #C4B59E 0%, #8C7B6B 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'inset 0 0 0 1px rgba(26,22,18,0.08)',
        }}
      >
        <Home style={{ width: 14, height: 14, color: '#F5F0E8', strokeWidth: 1.75 }} />
      </div>
    )
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: tone.dim,
        color: tone.fg,
        fontFamily: "'DM Sans', sans-serif",
        fontWeight: 700,
        fontSize: 10,
        letterSpacing: '-0.01em',
      }}
    >
      {subject.initials}
    </div>
  )
}
