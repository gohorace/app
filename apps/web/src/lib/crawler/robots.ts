/**
 * Minimal robots.txt fetch + parse — HOR-385.
 *
 * We are a well-behaved crawler of the agent's OWN site (they granted us
 * access on connect), but we still honour robots.txt: read Disallow/Allow for
 * our UA (falling back to `*`), the global Sitemap: directives, and
 * Crawl-delay. Parsing is intentionally small — longest-match Allow-vs-Disallow,
 * default allow — which covers the real-world directives agent sites use.
 */

import { fetchPage, CRAWLER_UA } from './fetch'

export interface Robots {
  /** True if our UA may fetch `path` (a pathname like "/sold/123"). */
  allowed: (path: string) => boolean
  /** Absolute sitemap URLs declared in robots.txt. */
  sitemaps: string[]
  /** Crawl-delay in ms (0 = none specified). */
  crawlDelayMs: number
}

const UA_TOKEN = CRAWLER_UA.split('/')[0].toLowerCase() // "horacebot"

interface Rule {
  allow: boolean
  path: string
}

/** Allow-all default used when robots.txt is missing/unreachable. */
function allowAll(sitemaps: string[] = []): Robots {
  return { allowed: () => true, sitemaps, crawlDelayMs: 0 }
}

export function parseRobots(txt: string): Robots {
  const lines = txt.split(/\r?\n/)
  const sitemaps: string[] = []

  // Collect rule groups keyed by the user-agents they apply to.
  const groups: { agents: string[]; rules: Rule[]; crawlDelay: number }[] = []
  let current: { agents: string[]; rules: Rule[]; crawlDelay: number } | null = null
  let lastWasAgent = false

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const field = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()

    if (field === 'sitemap') {
      if (value) sitemaps.push(value)
      continue
    }
    if (field === 'user-agent') {
      // Consecutive User-agent lines share the following rule block.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: 0 }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current) continue
    if (field === 'disallow') current.rules.push({ allow: false, path: value })
    else if (field === 'allow') current.rules.push({ allow: true, path: value })
    else if (field === 'crawl-delay') {
      const n = Number(value)
      if (!Number.isNaN(n)) current.crawlDelay = n
    }
  }

  // Pick the most specific applicable group: our UA token wins over '*'.
  const ours = groups.find((g) => g.agents.some((a) => a === UA_TOKEN || UA_TOKEN.includes(a)))
  const star = groups.find((g) => g.agents.includes('*'))
  const group = ours ?? star

  const crawlDelayMs = group ? Math.round((group.crawlDelay || 0) * 1000) : 0

  if (!group || group.rules.length === 0) {
    // No path rules, but a crawl-delay-only group still carries its delay.
    return { allowed: () => true, sitemaps, crawlDelayMs }
  }

  const rules = group.rules

  const allowed = (path: string): boolean => {
    // Longest matching directive wins; ties go to Allow (standard behaviour).
    let best: Rule | null = null
    for (const r of rules) {
      if (r.path === '') {
        // "Disallow:" (empty) means allow-all for this group.
        if (!r.allow) continue
      }
      if (path.startsWith(r.path) || r.path === '') {
        if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) {
          best = r
        }
      }
    }
    return best ? best.allow : true
  }

  return { allowed, sitemaps, crawlDelayMs }
}

export async function fetchRobots(origin: string): Promise<Robots> {
  let robotsUrl: string
  try {
    robotsUrl = new URL('/robots.txt', origin).toString()
  } catch {
    return allowAll()
  }
  const res = await fetchPage(robotsUrl, { accept: 'text/plain,*/*' })
  if (!res.ok || !res.html) return allowAll()
  return parseRobots(res.html)
}
