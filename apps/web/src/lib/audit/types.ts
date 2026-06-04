/**
 * Site audit — shared types (client + server).
 *
 * The `/audit` experience runs five checks against a real-estate agent's
 * website and renders a findings report in Horace's voice. These types are
 * the data contract between the audit backend (`/api/site-audit/run`) and the
 * report UI. Keep them framework-free so both sides can import them.
 */

export type Band = 'fix' | 'watch' | 'good'

export type CheckId = 'speed' | 'mobile' | 'forms' | 'tracking' | 'discovery'

/** One rendered finding block in the report. */
export interface Finding {
  id: CheckId
  /** H2 name — "Speed" / "Mobile" / "Forms" / "Tracking" / "Discovery basics". */
  name: string
  band: Band
  /** 2–3 sentence Horace-voice paragraph. */
  body: string
  /** Compact metric chip, e.g. "5.2s", "9 fields", "all firing". */
  metric: string
  /**
   * Short single-line version for the Top-3 callout. Only present on findings
   * surfaced into the Top-3 (the worst "fix" findings).
   */
  topLine?: string
  /**
   * The check couldn't be read (site blocked automated tools, or the upstream
   * API failed). The band is still set softly so the card renders calmly.
   */
  blocked?: boolean
}

export interface AuditResult {
  /** Normalised bare domain, e.g. "agentsite.com.au". */
  domain: string
  /** Findings in fixed display order: speed, mobile, forms, tracking, discovery. */
  findings: Finding[]
  /** Counts for the verdict line. solid = bands === 'good'; work = the rest. */
  verdict: { solid: number; work: number }
  /** Up to three short lines for the Top-3 callout, worst first. */
  topThree: string[]
  /** True when every finding is "good" — softens the opener, hides Top-3. */
  allGood: boolean
  /**
   * One or more checks couldn't be read cleanly (PageSpeed flaked, or the site
   * blocked the crawler). The report still renders; the affected cards say so.
   */
  partial: boolean
}

/** Error envelope returned by `/api/site-audit/run` instead of a result. */
export type AuditError =
  | { error: 'invalid' } // domain didn't pass shape validation
  | { error: 'unreachable' } // DNS/connection failure — site isn't there
  | { error: 'timeout' } // the audit ran past the hard ceiling

export type RunResponse = AuditResult | AuditError

export function isAuditError(r: RunResponse): r is AuditError {
  return (r as AuditError).error !== undefined
}
