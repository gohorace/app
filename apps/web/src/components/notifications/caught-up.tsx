import { Check } from 'lucide-react'

/**
 * "You're all caught up" footer at the bottom of the stream. Brief calls
 * this out as the implicit-pagination terminator — older moments load as
 * the agent scrolls past it.
 */
export function CaughtUp() {
  return (
    <div style={{ padding: '28px 24px 18px', textAlign: 'center' }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 14px',
          background: 'rgba(61,82,70,0.08)',
          borderRadius: 9999,
          color: '#3D5246',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.05em',
        }}
      >
        <Check style={{ width: 12, height: 12, strokeWidth: 2.5 }} />
        You&rsquo;re all caught up
      </div>
      <div
        style={{
          fontFamily: "'Playfair Display', serif",
          fontStyle: 'italic',
          fontSize: 13,
          color: '#8C7B6B',
          marginTop: 12,
          lineHeight: 1.5,
        }}
      >
        Older moments load as you scroll.
      </div>
    </div>
  )
}
