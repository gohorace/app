import Image from 'next/image'

/**
 * Full-surface empty state. Brief copy is locked:
 *   "Quiet right now."
 *   "Horace is watching. You'll hear when something moves."
 * Two-line pattern from the empty-state guidance — voice-correct,
 * observational, no commands.
 */
export function EmptyState() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 32px',
        textAlign: 'center',
      }}
    >
      <Image
        src="/horace-parchment.png"
        alt=""
        width={64}
        height={64}
        style={{ borderRadius: '50%', marginBottom: 18, opacity: 0.95 }}
      />
      <div
        style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: 22,
          fontWeight: 600,
          color: '#1A1612',
          letterSpacing: '-0.02em',
          marginBottom: 8,
        }}
      >
        Quiet right now.
      </div>
      <div
        style={{
          fontFamily: "'Playfair Display', serif",
          fontStyle: 'italic',
          fontSize: 14,
          color: '#5A4D40',
          lineHeight: 1.55,
          maxWidth: 260,
        }}
      >
        Horace is watching. You&rsquo;ll hear when something moves.
      </div>
      <div
        style={{
          marginTop: 32,
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'rgba(140,123,107,0.6)',
        }}
      >
        Seize the moment &mdash; Horace
      </div>
    </div>
  )
}
