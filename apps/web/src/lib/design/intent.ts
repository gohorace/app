/**
 * Shared intent palette + helpers used by both the email templates
 * (apps/web/src/lib/notifications/email.ts) and the in-app Digest UI
 * (apps/web/src/components/digest/*).
 *
 * Email needs hex-only inline values (no CSS vars); web can use the same.
 * Single source of truth — change here, change everywhere.
 */

export type IntentLevel = 'high' | 'mid' | 'low'

export interface IntentStyle {
  /** Background tint (rgba or hex) for badge backgrounds + avatar fills */
  bg: string
  /** Foreground colour for label text + avatar text */
  fg: string
  /** Solid dot colour used in the badge */
  dot: string
}

export const INTENT_PALETTE: Record<IntentLevel, IntentStyle> = {
  high: { bg: 'rgba(196,98,45,0.10)', fg: '#9C4A1F', dot: '#C4622D' },
  mid:  { bg: 'rgba(181,146,42,0.12)', fg: '#7A6300', dot: '#B5922A' },
  low:  { bg: 'rgba(61,82,70,0.10)',  fg: '#3D5246', dot: '#3D5246' },
}

export const INTENT_LABEL: Record<IntentLevel, string> = {
  high: 'High intent',
  mid:  'Worth watching',
  low:  'Quietly circling',
}

/**
 * Threshold-based intent level. Mirrors the buckets used by the dashboard
 * SignalCard and the contact detail page's intent helper.
 *
 * - score >= 50 → high
 * - score >= 20 → mid
 * - score >= 5  → low
 * - else        → null (no intent — "Quiet")
 */
export function intentForScore(score: number): IntentLevel | null {
  if (score >= 50) return 'high'
  if (score >= 20) return 'mid'
  if (score >= 5)  return 'low'
  return null
}

/**
 * Avatar styling for a given intent. Used by both Digest signal cards
 * and email contact cards. Returns a solid colour for the avatar bg
 * (not the tinted bg) so initials sit on a confident chip.
 */
export const INTENT_AVATAR_BG: Record<IntentLevel | 'none', string> = {
  high: '#C4622D',
  mid:  '#B5922A',
  low:  '#3D5246',
  none: '#8C7B6B',
}

// ── Guidance copy modes ──────────────────────────────────────────────────────
// Three classifications mapping nudge tone to signal type. Renders as a
// small icon + uppercase label above the italic nudge on each signal card.

export type GuidanceMode = 'advisory' | 'contextual' | 'time-sensitive'

export interface GuidanceStyle {
  /** Display label (uppercase rendered) */
  label: string
  /** Lucide icon name */
  icon: 'lightbulb' | 'eye' | 'clock'
  /** Foreground colour for icon + label */
  color: string
}

export const GUIDANCE: Record<GuidanceMode, GuidanceStyle> = {
  'advisory':       { label: 'Advisory',       icon: 'lightbulb', color: '#C4622D' },
  'contextual':     { label: 'Contextual',     icon: 'eye',       color: '#8C7B6B' },
  'time-sensitive': { label: 'Time-sensitive', icon: 'clock',     color: '#9C4A1F' },
}

/**
 * Pick a guidance mode for a signal based on its top event type. Mirrors
 * the design's intent: form-submit windows close fast (time-sensitive),
 * returning visitors are pattern-recognition moments (advisory), the rest
 * are observational (contextual).
 */
export function guidanceForEventType(eventType: string | null | undefined): GuidanceMode {
  switch (eventType) {
    case 'form_submit':
    case 'campaign_click':
      return 'time-sensitive'
    case 'return_visit':
      return 'advisory'
    default:
      return 'contextual'
  }
}
