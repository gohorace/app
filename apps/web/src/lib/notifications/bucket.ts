/**
 * Bucket a `notification_log.sent_at` timestamp into one of the four
 * time-window sections the stream uses: today, yesterday, this week, earlier.
 *
 * Boundaries are computed in the agent's timezone (from `agent_settings.timezone`).
 * "This week" is days [-6..-2] inclusive relative to "today" in that tz —
 * i.e. anything older than yesterday but within the last seven calendar
 * days. "Earlier" is everything older than that.
 *
 * No new deps — we use `Intl.DateTimeFormat` with `timeZone` to get the
 * tz-local calendar date as a `YYYY-MM-DD` string, then diff. This is
 * the same pattern the digest's cron uses.
 */

import type { Bucket } from '@/components/notifications/moment-types'

const DEFAULT_TZ = 'Australia/Sydney'

function localDateKey(at: Date, tz: string): string {
  // `en-CA` produces ISO-style YYYY-MM-DD, which is what we want.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

function daysBetween(aKey: string, bKey: string): number {
  // Parse both keys as UTC midnight; the day-diff is independent of tz.
  const a = Date.parse(aKey + 'T00:00:00Z')
  const b = Date.parse(bKey + 'T00:00:00Z')
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY
  return Math.round((a - b) / (24 * 60 * 60 * 1000))
}

export function bucketFor(sentAt: Date, now: Date, tz: string | null | undefined = DEFAULT_TZ): Bucket {
  const zone = tz || DEFAULT_TZ
  const nowKey = localDateKey(now, zone)
  const sentKey = localDateKey(sentAt, zone)
  const diff = daysBetween(nowKey, sentKey)

  if (diff <= 0) return 'today'
  if (diff === 1) return 'yesterday'
  if (diff <= 6) return 'week'
  return 'earlier'
}

/**
 * Short, casual time-ago string per the brief's voice — `12m`, `2h`,
 * `Yesterday`, or a date like `May 14` for older rows. We deliberately
 * don't use `formatDistanceToNow(..., { addSuffix: true })` here because
 * the brief locks the casual form ("12m" not "12 minutes ago").
 */
export function formatTimeAgo(sentAt: Date, now: Date, tz: string | null | undefined = DEFAULT_TZ): string {
  const diffMs = now.getTime() - sentAt.getTime()
  const diffMin = Math.round(diffMs / 60_000)
  const diffHr = Math.round(diffMs / 3_600_000)

  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m`

  // For anything ≥1h that still falls on the same local day, render as Nh.
  const bucket = bucketFor(sentAt, now, tz)
  if (bucket === 'today') return `${diffHr}h`
  if (bucket === 'yesterday') return 'Yesterday'

  // Older — short month-day, no year (we'll never render older than a few weeks here).
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: tz || DEFAULT_TZ,
    month: 'short',
    day: 'numeric',
  }).format(sentAt)
}
