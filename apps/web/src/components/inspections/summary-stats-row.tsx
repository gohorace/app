/**
 * SummaryStatsRow — the three-stat rollup above the inspections past list
 * (HOR-249): total sign-ins captured / now active / in pipeline. The
 * middle stat (now active) carries the terracotta accent per the v2
 * prototype. Also reused as the 4-stat grid on the past-detail page when
 * `stats` carries four entries.
 */

export interface SummaryStat {
  label: string
  value: number
  accent?: boolean
}

export function SummaryStatsRow({ stats }: { stats: SummaryStat[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${stats.length}, 1fr)`,
        gap: 12,
        marginBottom: 22,
      }}
    >
      {stats.map((s) => (
        <div
          key={s.label}
          style={{
            background: '#FAF7F2',
            border: `1px solid ${s.accent ? 'rgba(196,98,45,0.25)' : 'rgba(140,123,107,0.2)'}`,
            borderRadius: 12,
            padding: '16px 18px',
          }}
        >
          <div
            className="font-display"
            style={{
              fontSize: 30,
              fontWeight: 600,
              lineHeight: 1,
              letterSpacing: '-0.02em',
              color: s.accent ? '#C4622D' : '#1A1612',
            }}
          >
            {s.value}
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#8C7B6B',
            }}
          >
            {s.label}
          </div>
        </div>
      ))}
    </div>
  )
}
