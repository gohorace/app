import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { postToOpsChannel } from '@/lib/notifications/slack'
import { fetchRobots } from '@/lib/crawler/robots'
import { discoverContentUrls, type DiscoveredUrl } from '@/lib/crawler/sitemap'
import { fetchPage, mapWithConcurrency } from '@/lib/crawler/fetch'
import { extractContent } from '@/lib/crawler/extract'

/**
 * GET /api/cron/crawl-agent-sites — HOR-385
 *
 * One claimed crawl job per tick, mirroring process-core-market-imports.
 * Because crawling needs HTTP (which can't run in a Postgres RPC), the work
 * spans ticks via the job's `url_queue`:
 *
 *   • discover tick (url_queue IS NULL): read robots.txt + sitemap, classify
 *     URLs, fill the queue. One round-trip-light tick.
 *   • drain ticks (url_queue is an array): fetch + extract + upsert a batch
 *     (BATCH pages, CONCURRENCY at a time), advance the queue. When empty →
 *     mark complete.
 *
 * Sized so a ≤500-page site finishes in ≤10 min: BATCH=60 → ~9 drain ticks
 * at one tick/minute, each well under the 60s function cap. Per-minute ticking
 * also rate-limits us to the agent's own (authorised) site.
 */

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_PAGES = 500
const BATCH = 60
const CONCURRENCY = 12

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: claimedRows, error: claimError } = await admin.rpc('claim_agent_crawl_job' as any)
  if (claimError) {
    console.error('[crawl-agent-sites] claim error', claimError)
    return NextResponse.json({ error: claimError.message }, { status: 500 })
  }
  const job = Array.isArray(claimedRows) ? claimedRows[0] : null
  if (!job) return NextResponse.json({ idle: true })

  try {
    // ── Discover phase ──────────────────────────────────────────────
    if (job.url_queue === null || job.url_queue === undefined) {
      const robots = await fetchRobots(job.website_url)
      const { urls, truncated } = await discoverContentUrls(
        job.website_url,
        robots.sitemaps,
        robots.allowed,
        MAX_PAGES,
      )

      if (truncated) {
        console.warn(
          `[crawl-agent-sites] job ${job.id} (${job.website_url}) yielded > ${MAX_PAGES} content URLs — capped`,
        )
      }

      if (urls.length === 0) {
        await admin
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from('agent_crawl_jobs' as any)
          .update({
            url_queue: [],
            total_urls: 0,
            status: 'complete',
            completed_at: new Date().toISOString(),
            heartbeat_at: new Date().toISOString(),
          })
          .eq('id', job.id)
        return NextResponse.json({ job_id: job.id, phase: 'discover', discovered: 0, done: true })
      }

      await admin
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from('agent_crawl_jobs' as any)
        .update({
          url_queue: urls,
          total_urls: urls.length,
          heartbeat_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      return NextResponse.json({ job_id: job.id, phase: 'discover', discovered: urls.length, truncated })
    }

    // ── Drain phase ─────────────────────────────────────────────────
    const queue = (job.url_queue as DiscoveredUrl[]) ?? []
    const batch = queue.slice(0, BATCH)
    const rest = queue.slice(BATCH)

    const outcomes = await mapWithConcurrency(batch, CONCURRENCY, async (item) => {
      const res = await fetchPage(item.url)
      if (!res.ok || !res.html) return { type: item.type, ok: false }
      const extracted = extractContent(res.html, res.finalUrl, item.type)
      const payload = {
        ...extracted,
        http_status: res.status,
        raw: { crawled_at: new Date().toISOString() },
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await admin.rpc('upsert_agent_site_content' as any, {
        p_workspace_id: job.workspace_id,
        p_agent_id: job.agent_id,
        p_payload: payload,
      })
      if (error) {
        console.error(`[crawl-agent-sites] upsert failed for ${item.url}:`, error.message)
        return { type: item.type, ok: false }
      }
      return { type: item.type, ok: true }
    })

    let listings = 0
    let sold = 0
    let reports = 0
    for (const o of outcomes) {
      if (!o || !o.ok) continue
      if (o.type === 'listing') listings++
      else if (o.type === 'sold') sold++
      else if (o.type === 'suburb_report') reports++
    }

    const done = rest.length === 0
    await admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('agent_crawl_jobs' as any)
      .update({
        url_queue: rest,
        pages_crawled: (job.pages_crawled ?? 0) + batch.length,
        listings_found: (job.listings_found ?? 0) + listings,
        sold_found: (job.sold_found ?? 0) + sold,
        reports_found: (job.reports_found ?? 0) + reports,
        heartbeat_at: new Date().toISOString(),
        ...(done ? { status: 'complete', completed_at: new Date().toISOString() } : {}),
      })
      .eq('id', job.id)

    return NextResponse.json({
      job_id: job.id,
      phase: 'drain',
      batch: batch.length,
      remaining: rest.length,
      listings,
      sold,
      reports,
      done,
    })
  } catch (err) {
    const message = formatError(err)
    console.error('[crawl-agent-sites] job failed', job.id, message)
    await admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('agent_crawl_jobs' as any)
      .update({ status: 'error', error: message, heartbeat_at: new Date().toISOString() })
      .eq('id', job.id)
    await postToOpsChannel(
      `:rotating_light: Crawl job failed — agent \`${job.agent_id}\` (${job.website_url}): ${message}`,
    )
    return NextResponse.json({ job_id: job.id, error: message }, { status: 500 })
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const e = err as { message?: string; code?: string; details?: string; hint?: string }
    const parts = [
      e.code ? `[${e.code}]` : null,
      e.message ?? null,
      e.details ?? null,
      e.hint ? `(hint: ${e.hint})` : null,
    ].filter(Boolean)
    if (parts.length > 0) return parts.join(' ')
  }
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}
