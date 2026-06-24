/**
 * Findings engine — turns raw metrics (PageSpeed + crawl) into the five
 * Horace-voice findings and the assembled report.
 *
 * Every copy string here is final, in Horace's voice: first person, warm, no
 * emoji, no exclamation marks, em dashes for rhythm, and the human implication
 * always leads the number. Bands are decided from thresholds, not vibes — see
 * the constants at the top of each builder.
 */

import type { AuditResult, Finding } from './types'
import type { PageSpeedMetrics } from './pagespeed'
import type { CrawlResult } from './crawl'

// ── Speed ───────────────────────────────────────────────────────────────────
function speedFinding(psi: PageSpeedMetrics | null): Finding {
  const base = { id: 'speed' as const, name: 'Speed' }
  if (!psi || (psi.lcpSeconds == null && psi.perfScore == null)) {
    return {
      ...base,
      band: 'watch',
      blocked: true,
      metric: 'no read',
      body: "I couldn't get a clean read on speed right now. Try again in a few minutes — or skip ahead, the rest is here.",
    }
  }

  const lcp = psi.lcpSeconds
  if (lcp != null) {
    if (lcp <= 2.5) {
      return {
        ...base,
        band: 'good',
        metric: `${lcp}s`,
        body: `Your site loads in about ${lcp} seconds on mobile — quick enough that you're not losing people to a spinner. That's the hardest of these five to get right, and you've got it. Nothing urgent here.`,
      }
    }
    if (lcp <= 4) {
      return {
        ...base,
        band: 'watch',
        metric: `${lcp}s`,
        body: `Your site takes about ${lcp} seconds to load on mobile. It's not painful, but it's the slow side of fine — and on a phone, every extra second quietly costs you a few visitors before they've seen a thing. Worth a tune-up when you get a window.`,
      }
    }
    return {
      ...base,
      band: 'fix',
      metric: `${lcp}s`,
      topLine: `Your homepage takes ${lcp} seconds to load on mobile — you're losing most of your phone visitors before they see anything.`,
      body: `Your site takes ${lcp} seconds to load on mobile. More than half of phone visitors leave a page that takes longer than three seconds — so you're losing the most valuable visitor you've got before they see a single listing. This is the first thing I'd fix.`,
    }
  }

  // No LCP, but we have a performance score — band on that instead.
  const score = psi.perfScore as number
  if (score >= 90) {
    return {
      ...base,
      band: 'good',
      metric: `${score}/100`,
      body: `Your site scores ${score} out of 100 for speed on mobile — quick enough that you're not losing people to a slow load. That's the hardest of these five to get right. Nothing urgent here.`,
    }
  }
  if (score >= 50) {
    return {
      ...base,
      band: 'watch',
      metric: `${score}/100`,
      body: `Your site scores ${score} out of 100 for speed on mobile. It's the slow side of fine — and on a phone, every extra second quietly costs you a few visitors before they've seen a thing. Worth a tune-up when you get a window.`,
    }
  }
  return {
    ...base,
    band: 'fix',
    metric: `${score}/100`,
    topLine: `Your site scores ${score} out of 100 for mobile speed — you're losing phone visitors to the load before they see anything.`,
    body: `Your site scores ${score} out of 100 for speed on mobile. More than half of phone visitors leave a page that loads slowly — so you're losing the most valuable visitor you've got before they see a single listing. This is the first thing I'd fix.`,
  }
}

// ── Mobile ──────────────────────────────────────────────────────────────────
function mobileFinding(psi: PageSpeedMetrics | null): Finding {
  const base = { id: 'mobile' as const, name: 'Mobile' }
  if (!psi || (psi.cls == null && psi.viewportOk == null && psi.tapTargetsOk == null)) {
    return {
      ...base,
      band: 'watch',
      blocked: true,
      metric: 'no read',
      body: "I couldn't get a clean read on how it holds up on mobile right now. Try again in a few minutes — the rest of the report is here.",
    }
  }

  if (psi.viewportOk === false) {
    return {
      ...base,
      band: 'fix',
      metric: 'needs a fit',
      topLine:
        "On a phone, your site isn't set up to fit the screen — visitors have to pinch and zoom just to read it.",
      body: "On a phone, the page isn't set up to fit the screen, so visitors have to pinch and zoom just to read it. That's enough friction to lose someone who's only half-decided to stay. Setting a proper mobile viewport is a small fix with an outsized payoff.",
    }
  }

  const issues: string[] = []
  if (psi.cls != null && psi.cls > 0.1) issues.push('the page shifts around as it loads')
  if (psi.tapTargetsOk === false)
    issues.push('a few tap targets are smaller than a thumb wants')

  if (issues.length === 0) {
    return {
      ...base,
      band: 'good',
      metric: 'solid',
      body: "On a phone it holds together nicely — things sit where a thumb expects them and the layout stays put while it loads. That's the experience most of your visitors are getting, and it's a good one. Nothing to do here.",
    }
  }
  return {
    ...base,
    band: 'watch',
    metric: 'mostly fine',
    body: `On a phone, most of it holds together — but ${joinAnd(issues)}. Nothing broken, just a little friction in the moment someone's deciding whether to stay. Worth tightening when you get a window.`,
  }
}

// ── Forms ───────────────────────────────────────────────────────────────────
function formsFinding(crawl: CrawlResult): Finding {
  const base = { id: 'forms' as const, name: 'Forms' }
  if (crawl.blocked || (!crawl.ok && !crawl.resolved)) {
    return blockedFinding(base)
  }

  const n = crawl.maxFormFields
  if (n == null) {
    return {
      ...base,
      band: 'watch',
      metric: 'none found',
      body: "I couldn't find an enquiry or appraisal form on the pages I checked. If it's there, it may be behind a script I can't read — but if it isn't, that's the easiest win on this list. A short form is how a browsing vendor becomes a lead, so it's worth making sure there's an obvious one.",
    }
  }

  if (n <= 4) {
    return {
      ...base,
      band: 'good',
      metric: `${n} fields`,
      body: `Your enquiry form asks for ${n} ${plural(n, 'field')} — short enough that someone can fill it in without second-guessing. That restraint is doing more for your conversion than most agents realise. Leave it as it is.`,
    }
  }
  if (n <= 6) {
    return {
      ...base,
      band: 'watch',
      metric: `${n} fields`,
      body: `Your form asks for ${n} fields. It's on the edge — every box past three or four is another small reason to close the tab. If you can drop a couple, you'll likely see more people finish. Worth a trim.`,
    }
  }
  return {
    ...base,
    band: 'fix',
    metric: `${n} fields`,
    topLine: `Your appraisal form asks for ${n} fields — conversion on forms that long is brutal.`,
    body: `Your appraisal form asks for ${n} fields before someone can hit send. Conversion on forms that long is brutal — every extra box is another reason to close the tab. Three or four would get you most of what you need at a fraction of the drop-off.`,
  }
}

// ── Tracking ────────────────────────────────────────────────────────────────
function trackingFinding(crawl: CrawlResult): Finding {
  const base = { id: 'tracking' as const, name: 'Tracking' }
  if (crawl.blocked || (!crawl.ok && !crawl.resolved)) {
    return blockedFinding(base)
  }

  if (crawl.hasAnalytics && crawl.hasPixel) {
    return {
      ...base,
      band: 'good',
      metric: 'all firing',
      body: "You've got analytics and a tracking pixel installed and firing cleanly. That means you can actually see what's working — which, honestly, puts you ahead of most agents I look at. Nothing to do here.",
    }
  }
  if (crawl.hasAnalytics) {
    return {
      ...base,
      band: 'watch',
      metric: 'analytics only',
      body: "You've got analytics running, so you can see your traffic — but there's no remarketing pixel, which means you can't follow up with the people who visited and left. That's the cheapest audience you'll ever reach. Worth adding one.",
    }
  }
  if (crawl.hasPixel) {
    return {
      ...base,
      band: 'watch',
      metric: 'pixel only',
      body: "You've got a tracking pixel firing but no proper analytics, so you can advertise to past visitors but can't see what's actually working on the site. Adding analytics gives you the other half of the picture.",
    }
  }
  return {
    ...base,
    band: 'fix',
    metric: 'nothing found',
    topLine:
      "There's no analytics or tracking on your site — every visitor who comes and goes is invisible to you.",
    body: "I couldn't find any analytics or tracking installed. That means every visitor who comes and goes is invisible to you — you're flying blind on what's working and what isn't. Putting basic analytics in place is a one-time job that pays off every week after.",
  }
}

// ── Discovery basics ────────────────────────────────────────────────────────
function discoveryFinding(crawl: CrawlResult): Finding {
  const base = { id: 'discovery' as const, name: 'Discovery basics' }
  if (crawl.blocked || (!crawl.ok && !crawl.resolved)) {
    return blockedFinding(base)
  }

  const headingsOk = crawl.h1Count === 1 && crawl.hasH2
  const schema = crawl.hasSchema

  if (headingsOk && schema) {
    return {
      ...base,
      band: 'good',
      metric: 'structured',
      body: "Your headings are structured the way search engines expect, and you've got schema markup telling them what you do. That's exactly how you stay readable to Google and the AI models people now ask for recommendations. Well set up.",
    }
  }
  if (!headingsOk && !schema) {
    return {
      ...base,
      band: 'fix',
      metric: 'missing',
      topLine:
        'Your headings and schema markup are missing — search engines and AI models are skipping past you.',
      body: "Your headings aren't structured and there's no schema markup on the page. That's how search engines and the AI models people now ask for recommendations understand what you do — without it, they're skimming straight past you. Adding both is a quiet, one-time fix with a long tail.",
    }
  }
  if (headingsOk && !schema) {
    return {
      ...base,
      band: 'watch',
      metric: 'no schema',
      body: "Your headings are in good shape, but there's no schema markup — the structured data that tells search engines and AI models exactly what you do. Adding it is a quiet, one-time fix that helps the right people find you.",
    }
  }
  // schema present, headings tangled
  const h1note =
    crawl.h1Count === 0
      ? "there's no clear main heading"
      : 'there are several top-level headings competing'
  return {
    ...base,
    band: 'watch',
    metric: 'headings off',
    body: `You've got schema markup, but your heading structure is a bit tangled — ${h1note}. Tidy headings make it easier for search engines to read the page the way you'd want. Worth a small pass.`,
  }
}

// ── Assembly ────────────────────────────────────────────────────────────────

/** Order findings appear in the Top-3, worst-first among "fix" findings. */
const TOP3_RANK: Record<string, number> = {
  speed: 0,
  forms: 1,
  discovery: 2,
  mobile: 3,
  tracking: 4,
}

export function buildAuditResult(args: {
  domain: string
  psi: PageSpeedMetrics | null
  crawl: CrawlResult
}): AuditResult {
  const { domain, psi, crawl } = args

  const findings: Finding[] = [
    speedFinding(psi),
    mobileFinding(psi),
    formsFinding(crawl),
    trackingFinding(crawl),
    discoveryFinding(crawl),
  ]

  const solid = findings.filter((f) => f.band === 'good' && !f.blocked).length
  const work = findings.length - solid
  const allGood = findings.every((f) => f.band === 'good' && !f.blocked)
  const partial = findings.some((f) => f.blocked)

  const topThree = findings
    .filter((f) => f.band === 'fix' && f.topLine)
    .sort((a, b) => (TOP3_RANK[a.id] ?? 9) - (TOP3_RANK[b.id] ?? 9))
    .slice(0, 3)
    .map((f) => f.topLine as string)

  return {
    domain,
    findings,
    verdict: { solid, work },
    topThree,
    allGood,
    partial,
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────
function blockedFinding(base: { id: Finding['id']; name: string }): Finding {
  return {
    ...base,
    band: 'watch',
    blocked: true,
    metric: 'blocked',
    body: "Couldn't read this one — your site is blocking automated tools. Worth checking the others first.",
  }
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`
}
