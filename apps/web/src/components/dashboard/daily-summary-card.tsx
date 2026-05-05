interface DailySummaryCardProps {
  highCount: number
  totalSignals: number
  recentEvents: number
  topContactName: string | null
}

export function DailySummaryCard({
  highCount,
  totalSignals,
  recentEvents,
  topContactName,
}: DailySummaryCardProps) {
  const nudge = topContactName && highCount > 0
    ? `${highCount > 1 ? `${highCount} signals worth your attention today.` : 'One signal worth your attention today.'} ${topContactName} looks ready${highCount > 0 ? ' — worth a call.' : '.'}`
    : totalSignals > 0
      ? `${totalSignals} contact${totalSignals !== 1 ? 's' : ''} on Horace's radar. Keep an eye on the signals.`
      : 'Horace is watching. Your market, always.'

  return (
    <div style={{
      background: '#2E2823',
      borderRadius: '16px',
      padding: '18px 20px',
    }}>
      {/* From Horace */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginBottom: '10px',
      }}>
        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#C4622D' }} />
        <span style={{
          fontSize: '9px',
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'rgba(245,240,232,0.35)',
          fontFamily: 'var(--font-body)',
        }}>
          Horace
        </span>
      </div>

      {/* Message */}
      <p style={{
        fontSize: '15px',
        color: 'rgba(245,240,232,0.88)',
        lineHeight: 1.55,
        marginBottom: '16px',
        fontFamily: 'var(--font-body)',
      }}>
        &ldquo;{nudge}&rdquo;
      </p>

      {/* Stats */}
      <div style={{ display: 'flex' }}>
        <Stat value={totalSignals} label="Active signals" />
        <Stat value={highCount}   label="High intent"    />
        <Stat value={recentEvents} label="Events today"  last />
      </div>

      {/* Signature */}
      <div style={{
        fontSize: '9px',
        fontWeight: 500,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'rgba(245,240,232,0.2)',
        marginTop: '14px',
        paddingTop: '12px',
        borderTop: '1px solid rgba(245,240,232,0.07)',
        fontFamily: 'var(--font-body)',
      }}>
        Seize the moment — Horace
      </div>
    </div>
  )
}

function Stat({ value, label, last }: { value: number; label: string; last?: boolean }) {
  return (
    <div style={{
      flex: 1,
      borderRight: last ? 'none' : '1px solid rgba(245,240,232,0.08)',
      paddingRight: last ? 0 : '12px',
      marginRight: last ? 0 : '12px',
    }}>
      <div style={{
        fontSize: '22px',
        fontWeight: 600,
        color: '#FAF7F2',
        letterSpacing: '-0.02em',
        lineHeight: 1,
        fontFamily: 'var(--font-body)',
      }}>
        {value}
      </div>
      <div style={{
        fontSize: '10px',
        color: 'rgba(245,240,232,0.4)',
        marginTop: '4px',
        fontWeight: 500,
        fontFamily: 'var(--font-body)',
      }}>
        {label}
      </div>
    </div>
  )
}
