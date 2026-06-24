/**
 * Lightweight, dependency-free crawl — the source for the Forms, Tracking and
 * Discovery checks.
 *
 * We fetch the homepage HTML (and, for forms, a couple of likely enquiry pages)
 * and extract a handful of targeted signals with scoped regex rather than a
 * full DOM parser. PageSpeed already does the heavy lifting for Speed/Mobile;
 * here we only need to *detect* patterns, so regex over the raw markup is a fair
 * trade against pulling in a parser dependency.
 *
 * Everything is best-effort: a blocked or unreachable page yields a result with
 * `blocked`/`networkError` set, and the findings layer renders that calmly
 * rather than failing the whole audit.
 */

const UA =
  'Mozilla/5.0 (compatible; HoraceSiteAudit/1.0; +https://www.gohorace.com/audit)'
const FETCH_TIMEOUT_MS = 12_000
const MAX_BYTES = 2_500_000 // don't read unbounded responses

export interface CrawlResult {
  /** The site resolved and returned HTML we could read. */
  ok: boolean
  /** Resolved at the network layer (DNS/TCP) — distinguishes blocked vs absent. */
  resolved: boolean
  /** Returned a hard block (403/401/429) — site is up but refusing tools. */
  blocked: boolean
  /** DNS/connection failure — the site isn't reachable at all. */
  networkError: boolean

  // ── Forms ──
  /** Field count of the largest enquiry form found, or null if none seen. */
  maxFormFields: number | null
  /** Which page the largest form was found on (homepage or a guessed path). */
  formSource: string | null

  // ── Tracking ──
  hasAnalytics: boolean
  hasPixel: boolean
  /** Friendly names of the tools we recognised (for copy colour). */
  trackingTools: string[]

  // ── Discovery ──
  h1Count: number
  hasH2: boolean
  hasSchema: boolean
}

const EMPTY: Omit<CrawlResult, 'ok' | 'resolved' | 'blocked' | 'networkError'> = {
  maxFormFields: null,
  formSource: null,
  hasAnalytics: false,
  hasPixel: false,
  trackingTools: [],
  h1Count: 0,
  hasH2: false,
  hasSchema: false,
}

interface FetchedPage {
  html: string | null
  status: number
  networkError: boolean
}

async function fetchPage(url: string): Promise<FetchedPage> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-AU,en;q=0.9',
      },
    })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !type.includes('html')) {
      return { html: null, status: res.status, networkError: false }
    }
    const html = await readCapped(res)
    return { html, status: res.status, networkError: false }
  } catch {
    return { html: null, status: 0, networkError: true }
  } finally {
    clearTimeout(timer)
  }
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return await res.text()
  const decoder = new TextDecoder()
  let out = ''
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    out += decoder.decode(value, { stream: true })
    if (total >= MAX_BYTES) {
      await reader.cancel()
      break
    }
  }
  return out
}

export async function crawlSite(domain: string): Promise<CrawlResult> {
  const home = await fetchPage(`https://${domain}/`)

  if (home.networkError) {
    return {
      ok: false,
      resolved: false,
      blocked: false,
      networkError: true,
      ...EMPTY,
    }
  }
  if (home.html == null) {
    // Resolved but refused or non-HTML — treat 401/403/429 as a block.
    const blocked = [401, 403, 429].includes(home.status)
    return {
      ok: false,
      resolved: true,
      blocked,
      networkError: false,
      ...EMPTY,
    }
  }

  const html = home.html
  const result: CrawlResult = {
    ok: true,
    resolved: true,
    blocked: false,
    networkError: false,
    ...EMPTY,
    ...detectTracking(html),
    ...detectDiscovery(html),
  }

  // Forms: homepage first, then a couple of likely enquiry pages. Stop early
  // once we've found a sizeable form — we want the worst (largest) one.
  let bestFields = countFormFields(html)
  let bestSource = bestFields != null ? domain : null
  if (bestFields == null || bestFields < 5) {
    for (const path of ['contact', 'appraisal', 'contact-us', 'request-appraisal']) {
      const page = await fetchPage(`https://${domain}/${path}`)
      if (page.html) {
        const n = countFormFields(page.html)
        if (n != null && (bestFields == null || n > bestFields)) {
          bestFields = n
          bestSource = `${domain}/${path}`
        }
        if (bestFields != null && bestFields >= 5) break
      }
    }
  }
  result.maxFormFields = bestFields
  result.formSource = bestSource

  return result
}

// ── Forms: count user-fillable fields in the largest <form> ─────────────────
export function countFormFields(html: string): number | null {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi)
  if (!forms || forms.length === 0) return null
  let max = 0
  let sawAny = false
  for (const form of forms) {
    const count = countFieldsInForm(form)
    if (count > 0) sawAny = true
    if (count > max) max = count
  }
  return sawAny ? max : null
}

function countFieldsInForm(form: string): number {
  let n = 0
  // <input> — exclude hidden/submit/button/image/reset (not user-entered data).
  const inputs = form.match(/<input\b[^>]*>/gi) ?? []
  const skip = /type\s*=\s*["']?(hidden|submit|button|image|reset)["']?/i
  for (const tag of inputs) {
    if (!skip.test(tag)) n++
  }
  n += (form.match(/<select\b/gi) ?? []).length
  n += (form.match(/<textarea\b/gi) ?? []).length
  return n
}

// ── Tracking: analytics + remarketing pixels ────────────────────────────────
const ANALYTICS_SIGS: Array<[RegExp, string]> = [
  [/googletagmanager\.com|gtm\.start|gtag\(/i, 'Google'],
  [/google-analytics\.com|\bUA-\d{4,}|\bG-[A-Z0-9]{6,}/i, 'Google Analytics'],
  [/plausible\.io/i, 'Plausible'],
  [/static\.cloudflareinsights\.com/i, 'Cloudflare'],
  [/cdn\.usefathom\.com/i, 'Fathom'],
  [/matomo|piwik/i, 'Matomo'],
  [/cdn\.segment\.com|analytics\.js/i, 'Segment'],
  [/mixpanel/i, 'Mixpanel'],
  [/hotjar\.com|static\.hotjar/i, 'Hotjar'],
  [/clarity\.ms/i, 'Clarity'],
]
const PIXEL_SIGS: Array<[RegExp, string]> = [
  [/connect\.facebook\.net|fbq\(|facebook pixel/i, 'Meta pixel'],
  [/\bAW-\d{6,}/i, 'Google Ads'],
  [/analytics\.tiktok\.com|ttq\.(load|track)/i, 'TikTok pixel'],
  [/snap\.licdn\.com|_linkedin_partner_id/i, 'LinkedIn insight'],
  [/sc-static\.net|snaptr\(/i, 'Snap pixel'],
]

export function detectTracking(html: string): Pick<
  CrawlResult,
  'hasAnalytics' | 'hasPixel' | 'trackingTools'
> {
  const tools = new Set<string>()
  let hasAnalytics = false
  let hasPixel = false
  for (const [re, name] of ANALYTICS_SIGS) {
    if (re.test(html)) {
      hasAnalytics = true
      tools.add(name)
    }
  }
  for (const [re, name] of PIXEL_SIGS) {
    if (re.test(html)) {
      hasPixel = true
      tools.add(name)
    }
  }
  return { hasAnalytics, hasPixel, trackingTools: [...tools] }
}

// ── Discovery: heading structure + schema.org markup ────────────────────────
export function detectDiscovery(html: string): Pick<
  CrawlResult,
  'h1Count' | 'hasH2' | 'hasSchema'
> {
  const h1Count = (html.match(/<h1\b/gi) ?? []).length
  const hasH2 = /<h2\b/i.test(html)
  const hasSchema =
    /<script[^>]+type\s*=\s*["']application\/ld\+json["']/i.test(html) ||
    /itemscope[\s\S]{0,400}?schema\.org/i.test(html) ||
    /itemtype\s*=\s*["']https?:\/\/schema\.org/i.test(html)
  return { h1Count, hasH2, hasSchema }
}
