/**
 * Batch consecutive moments on the same subject within a short window
 * (default 2h) into a single stacked card. Per the brief:
 *
 *   "When multiple moments fire on the same contact or property within
 *    a short window (default 2 hours), the feed groups them into a
 *    single stacked card. Top of card shows the most recent moment
 *    headline. Below: +N more moments on this contact."
 *
 * Each individual moment still exists in the database — the batching
 * happens at render time only. The contact / property timeline shows
 * the full list when the agent opens the subject.
 *
 * Input is expected pre-sorted by `sentAtMs DESC` (newest first), which
 * is the order `/api/notifications` returns. We only collapse adjacent
 * runs — same subject, all within `windowMs` of the most-recent moment.
 */

import type { StreamMoment } from '@/components/notifications/moment-types'

export interface GroupStackOptions {
  /** Pre-collapse `sent_at` timestamps in ms-since-epoch, parallel to items. */
  sentAtMs: number[]
  /** Batching window in ms. Defaults to 2h per brief. */
  windowMs?: number
}

const DEFAULT_WINDOW_MS = 2 * 60 * 60 * 1000

function subjectKey(m: StreamMoment): string {
  return `${m.subject.kind}:${m.subject.id}`
}

export function groupStacks(items: StreamMoment[], opts: GroupStackOptions): StreamMoment[] {
  const { sentAtMs, windowMs = DEFAULT_WINDOW_MS } = opts
  if (items.length !== sentAtMs.length) {
    throw new Error('groupStacks: items.length must equal sentAtMs.length')
  }
  if (items.length === 0) return items

  const out: StreamMoment[] = []
  let i = 0
  while (i < items.length) {
    const head = items[i]
    const headTs = sentAtMs[i]
    const key = subjectKey(head)

    // Greedily consume subsequent rows that match subject + fall inside the window.
    const extras: string[] = []
    let j = i + 1
    while (j < items.length) {
      const next = items[j]
      const nextTs = sentAtMs[j]
      if (subjectKey(next) !== key) break
      if (headTs - nextTs > windowMs) break
      extras.push(next.headline)
      j++
    }

    if (extras.length > 0) {
      out.push({ ...head, stack: { count: extras.length, headlines: extras } })
    } else {
      out.push(head)
    }
    i = j
  }
  return out
}
