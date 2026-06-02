'use client'

/**
 * Horace — Digest V2 right rail: "Your rhythm" intensity strips.
 *
 * Replaces the old passive "This week so far" + "Your lists" panels. Teaches
 * the product's core lesson at a glance — YOUR ACTION GENERATES SIGNAL.
 *
 *  - Activity (coral) — signal-generating actions you took: tracked sends,
 *    shared listing links, contacts added to watch. Never logins/opens.
 *  - Signal (teal/moss) — signal that came back.
 *  - One cell per day, columns aligned between strips, so signal visibly
 *    trails activity by ~a day. Shaded by OPACITY of one colour (not a hex
 *    ramp) so it reads on cream and inverts correctly in dark mode.
 *  - Today is the last cell on the Activity strip. It renders empty until a
 *    real tracked send is recorded (wired from email_sends in Phase 2) — no
 *    interactive affordance; the cell fills only from a real action.
 *
 * Live (non-demo) data series — tracked sends from `email_sends`, returning
 * signal from `events` — wires in Phases 2–4. Phase 0 renders the demo series
 * and an empty placeholder in live mode.
 */

export interface DigestRailData {
  /** Activity strip colour (coral). */
  activityColor: string
  /** Signal strip colour (teal/moss). */
  signalColor: string
  /** 14 day labels, oldest → newest. e.g. "Fri 29". */
  days: string[]
  /** Per-day action counts. `null` = the open "today" cell (last entry). */
  activity: Array<number | null>
  /** Per-day returning-signal counts. `null` = no data. */
  signal: Array<number | null>
  /** Warm closing note under the strips. */
  note: string
}

interface DigestRailProps {
  data: DigestRailData
}

/** Cell opacity for a count. `null` → open cell (handled by caller). */
function shade(count: number | null | undefined, max: number): number | null {
  if (count === null || count === undefined) return null
  if (count === 0) return 0.07
  return 0.22 + 0.78 * (count / max)
}

/** rgba-hex suffix for an opacity, e.g. 0.6 → "99". */
function alphaHex(op: number): string {
  return Math.round(op * 255).toString(16).padStart(2, '0')
}

export function DigestRail({ data }: DigestRailProps) {
  const aMax = Math.max(1, ...data.activity.filter((n): n is number => n !== null))
  const sMax = Math.max(1, ...data.signal.filter((n): n is number => n !== null))

  return (
    <aside className="hidden lg:flex" style={railStyles.aside}>
      <div style={railStyles.card}>
        <div style={railStyles.eyebrow}>Your rhythm</div>
        <p style={railStyles.lede}>Your action is what makes the signal. Watch it trail by a day.</p>

        <div style={railStyles.readout}>Last 14 days</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 4 }}>
          <Strip
            label="Activity"
            sub="you took"
            color={data.activityColor}
            counts={data.activity}
            max={aMax}
          />
          <Strip
            label="Signal"
            sub="came back"
            color={data.signalColor}
            counts={data.signal}
            max={sMax}
          />
        </div>

        <div style={railStyles.legend}>
          <span style={railStyles.legendTxt}>Less</span>
          <div style={{ display: 'flex', gap: 3 }}>
            {[0.07, 0.3, 0.5, 0.72, 0.95].map((o, i) => (
              <span key={i} style={{ width: 12, height: 12, borderRadius: 3, background: `rgba(140,123,107,${o})` }} />
            ))}
          </div>
          <span style={railStyles.legendTxt}>More</span>
        </div>

        <p style={railStyles.railNote}>{data.note}</p>
      </div>
    </aside>
  )
}

// ── Single intensity strip ────────────────────────────────────────────────────

function Strip({
  label,
  sub,
  color,
  counts,
  max,
}: {
  label: string
  sub: string
  color: string
  counts: Array<number | null>
  max: number
}) {
  return (
    <div>
      <div style={railStyles.stripHead}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
        <span style={railStyles.stripLabel}>{label}</span>
        <span style={railStyles.stripSub}>{sub}</span>
      </div>
      <div style={railStyles.grid}>
        {counts.map((c, i) => {
          const op = shade(c, max)
          return (
            <div
              key={i}
              style={{
                ...railStyles.cell,
                background: op === null ? 'transparent' : `${color}${alphaHex(op)}`,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

const railStyles = {
  aside: { flexDirection: 'column', gap: 14, width: 288, flexShrink: 0, paddingTop: 4 },
  card: { background: '#FAF7F2', border: '1px solid rgba(140,123,107,0.2)', borderRadius: 12, padding: '16px 18px' },
  eyebrow: { fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', color: '#5E5246', marginBottom: 4 },
  lede: { margin: '0 0 12px', fontSize: 12, lineHeight: 1.45, color: '#8C7B6B' },
  readout: { fontSize: 11, color: '#9C4A1F', fontFamily: 'var(--font-mono)', minHeight: 16, marginBottom: 10 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(14, 1fr)', gap: 3 },
  cell: { height: 18, borderRadius: 3, border: 'none', padding: 0 },
  stripHead: { display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 7 },
  stripLabel: { fontSize: 12, fontWeight: 600, color: '#2E2823' },
  stripSub: { fontSize: 11, color: '#8C7B6B' },
  legend: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 },
  legendTxt: { fontSize: 10.5, color: '#8C7B6B' },
  railNote: {
    margin: '13px 0 0',
    paddingTop: 12,
    borderTop: '1px solid rgba(140,123,107,0.16)',
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 1.5,
    color: '#8C7B6B',
  },
} satisfies Record<string, React.CSSProperties>
