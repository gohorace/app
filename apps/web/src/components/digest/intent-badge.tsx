import { INTENT_LABEL, INTENT_PALETTE, type IntentLevel } from '@/lib/design/intent'

interface IntentBadgeProps {
  intent: IntentLevel
  label?: string
}

/**
 * Tinted pill with a dot — used in Digest signal cards. Label overrides the
 * default `INTENT_LABEL` mapping if a more specific phrase is needed
 * (e.g. "Newly known" on the anonymous-becomes-known variant).
 */
export function IntentBadge({ intent, label }: IntentBadgeProps) {
  const palette = INTENT_PALETTE[intent]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px',
        borderRadius: 9999,
        background: palette.bg,
        color: palette.fg,
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: palette.dot,
          flexShrink: 0,
        }}
      />
      {label ?? INTENT_LABEL[intent]}
    </span>
  )
}
