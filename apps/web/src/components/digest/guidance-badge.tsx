import { Lightbulb, Eye, Clock } from 'lucide-react'
import { GUIDANCE, type GuidanceMode } from '@/lib/design/intent'

const ICONS = {
  lightbulb: Lightbulb,
  eye:       Eye,
  clock:     Clock,
} as const

interface GuidanceBadgeProps {
  mode: GuidanceMode
}

/**
 * Small icon + uppercase label, rendered above the italic nudge in a
 * signal card. Three modes (advisory / contextual / time-sensitive)
 * mirror the design's "guidance copy modes" reference.
 */
export function GuidanceBadge({ mode }: GuidanceBadgeProps) {
  const g = GUIDANCE[mode]
  const Icon = ICONS[g.icon]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: g.color,
        fontFamily: 'var(--font-body)',
        lineHeight: 1.2,
      }}
    >
      <Icon style={{ width: 12, height: 12 }} aria-hidden />
      {g.label}
    </span>
  )
}
