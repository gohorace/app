/**
 * Google PageSpeed Insights (Lighthouse, mobile strategy) — the source for the
 * Speed and Mobile checks.
 *
 * One PSI call yields both: load timing (LCP/perf score → Speed) and mobile
 * stability/usability (CLS, viewport, tap targets → Mobile). We prefer CrUX
 * *field* data when the site has enough real-user traffic to report it, and
 * fall back to Lighthouse *lab* metrics otherwise.
 *
 * An API key (PAGESPEED_API_KEY) is optional but strongly recommended — the
 * keyless quota is tiny and rate-limits hard in production.
 */

export interface PageSpeedMetrics {
  /** Largest Contentful Paint, seconds. The Speed headline number. */
  lcpSeconds: number | null
  /** Lighthouse performance score, 0–100. */
  perfScore: number | null
  /** Cumulative Layout Shift (unitless). The "page shifts as it loads" signal. */
  cls: number | null
  /** Whether a usable mobile viewport meta is present (Lighthouse `viewport`). */
  viewportOk: boolean | null
  /** Whether tap targets are adequately sized (Lighthouse `tap-targets`). */
  tapTargetsOk: boolean | null
  /** True when LCP came from real-user field data rather than the lab run. */
  lcpFromField: boolean
}

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'
const PSI_TIMEOUT_MS = 55_000

export async function runPageSpeed(domain: string): Promise<PageSpeedMetrics> {
  const params = new URLSearchParams({
    url: `https://${domain}`,
    strategy: 'mobile',
  })
  params.append('category', 'performance')
  params.append('category', 'best-practices')
  const key = process.env.PAGESPEED_API_KEY
  if (key) params.set('key', key)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PSI_TIMEOUT_MS)
  let json: PsiResponse
  try {
    const res = await fetch(`${PSI_ENDPOINT}?${params.toString()}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`PSI ${res.status}`)
    json = (await res.json()) as PsiResponse
  } finally {
    clearTimeout(timer)
  }

  return mapMetrics(json)
}

function mapMetrics(json: PsiResponse): PageSpeedMetrics {
  const audits = json.lighthouseResult?.audits ?? {}
  const num = (id: string): number | null => {
    const v = audits[id]?.numericValue
    return typeof v === 'number' ? v : null
  }
  const score = (id: string): number | null => {
    const v = audits[id]?.score
    return typeof v === 'number' ? v : null
  }

  // LCP: prefer CrUX field percentile (ms) when present — it reflects what real
  // phones actually experience — else the lab metric.
  const fieldLcpMs =
    json.loadingExperience?.metrics?.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null
  const labLcpMs = num('largest-contentful-paint')
  const lcpMs = fieldLcpMs ?? labLcpMs
  const lcpSeconds = lcpMs != null ? Math.round((lcpMs / 1000) * 10) / 10 : null

  const perf = json.lighthouseResult?.categories?.performance?.score
  const perfScore = typeof perf === 'number' ? Math.round(perf * 100) : null

  // CLS: prefer field, else lab.
  const fieldCls =
    json.loadingExperience?.metrics?.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile ?? null
  const labCls = num('cumulative-layout-shift')
  // Field CLS percentile is ×100 (e.g. 12 → 0.12); lab is already unitless.
  const cls = fieldCls != null ? Math.round((fieldCls / 100) * 1000) / 1000 : labCls

  // viewport / tap-targets are pass(1)/fail(0)/null(not-applicable or removed in
  // newer Lighthouse). Treat a missing audit as "unknown", not "fail".
  const vp = score('viewport')
  const tt = score('tap-targets')

  return {
    lcpSeconds,
    perfScore,
    cls,
    viewportOk: vp == null ? null : vp >= 1,
    tapTargetsOk: tt == null ? null : tt >= 0.9,
    lcpFromField: fieldLcpMs != null,
  }
}

// ── Minimal shape of the PSI response we touch ──────────────────────────────
interface PsiAudit {
  numericValue?: number
  score?: number | null
}
interface PsiResponse {
  lighthouseResult?: {
    audits?: Record<string, PsiAudit>
    categories?: { performance?: { score?: number | null } }
  }
  loadingExperience?: {
    metrics?: {
      LARGEST_CONTENTFUL_PAINT_MS?: { percentile?: number }
      CUMULATIVE_LAYOUT_SHIFT_SCORE?: { percentile?: number }
    }
  }
}
