/**
 * Event-rendering helpers shared by the contact detail page and any
 * future surface that renders a behavioural timeline (e.g. property
 * detail in HOR-126).
 *
 * Lifted from apps/web/src/app/(dashboard)/contacts/[id]/page.tsx as part
 * of HOR-125 so the detail page rewrite doesn't duplicate this logic.
 *
 * Slice F (HOR-228) extends this to handle the email_* event family
 * — labels, kind bucket, collapse for repeated opens.
 */

export type RawEvent = {
  id: string
  event_type: string
  properties: Record<string, unknown>
  score_delta: number
  occurred_at: string
}

export type MergedEvent = RawEvent & {
  scroll_pct?: number
  /** Set by collapseEmailOpens when multiple opens against the same send fold into one row. */
  repeated_count?: number
}

/**
 * Merges scroll_depth events into their corresponding page_view /
 * property_view by matching on URL. scroll_depth rows are consumed and
 * removed from the list, with the max scroll % attached to the host event.
 */
export function mergeScrollDepth(events: RawEvent[]): MergedEvent[] {
  const scrollByUrl = new Map<string, number>()

  for (const e of events) {
    if (e.event_type !== 'scroll_depth') continue
    const url = String(e.properties.url ?? e.properties.path ?? '')
    const pct = typeof e.properties.pct === 'number' ? e.properties.pct : 90
    if (url && (!scrollByUrl.has(url) || pct > scrollByUrl.get(url)!)) {
      scrollByUrl.set(url, pct)
    }
  }

  const merged: MergedEvent[] = []
  for (const e of events) {
    if (e.event_type === 'scroll_depth') continue
    if (e.event_type === 'campaign_click') continue

    const url = String(e.properties.url ?? e.properties.path ?? '')
    const pct = url ? scrollByUrl.get(url) : undefined
    merged.push({ ...e, scroll_pct: pct })
  }

  return merged
}

/**
 * Collapse multiple `email_opened` events for the same email_send_id into a
 * single timeline row, keeping the most-recent occurred_at and tagging the
 * row with `repeated_count`. Image proxies (Gmail, Apple Mail) refetch the
 * tracking pixel multiple times per render, so without this the timeline
 * shows "Opened" five times in a row for one read.
 *
 * Apple MPP opens and bot prefetches are NOT collapsed into the human opens
 * — they're distinct signals that get their own labels in eventLabel(). A
 * real open + an MPP open against the same send remain two rows.
 *
 * Events without an `email_send_id` in properties are passed through
 * untouched (defensive — current emit_email_event always sets it).
 */
export function collapseEmailOpens(events: MergedEvent[]): MergedEvent[] {
  // Bucket index keys: `${email_send_id}::${signal}` where signal is one of
  //   'human' | 'mpp' | 'bot'
  // so an MPP open and a real open are kept as separate rows.
  function bucketKey(e: MergedEvent): string | null {
    if (e.event_type !== 'email_opened') return null
    const sendId = e.properties.email_send_id
    if (typeof sendId !== 'string') return null
    const signal = e.properties.apple_mpp
      ? 'mpp'
      : e.properties.likely_bot
        ? 'bot'
        : 'human'
    return `${sendId}::${signal}`
  }

  const buckets = new Map<string, { event: MergedEvent; count: number }>()
  const passthrough: MergedEvent[] = []

  for (const e of events) {
    const key = bucketKey(e)
    if (!key) {
      passthrough.push(e)
      continue
    }
    const existing = buckets.get(key)
    if (!existing) {
      buckets.set(key, { event: e, count: 1 })
    } else {
      // Keep the most recent occurred_at as the row anchor.
      const winner = e.occurred_at > existing.event.occurred_at ? e : existing.event
      buckets.set(key, { event: winner, count: existing.count + 1 })
    }
  }

  const collapsed: MergedEvent[] = passthrough.slice()
  for (const { event, count } of buckets.values()) {
    collapsed.push(count > 1 ? { ...event, repeated_count: count } : event)
  }

  // Preserve descending order — caller relies on this for the timeline.
  collapsed.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
  return collapsed
}

function consumptionVerb(pct: number | undefined, type: 'page' | 'listing'): string {
  if (pct === undefined) return 'browsed'
  if (pct >= 75) return type === 'listing' ? 'spent time on' : 'sat with'
  if (pct >= 40) return type === 'listing' ? 'looked through' : 'spent time on'
  return 'browsed'
}

/**
 * Horace-voiced label for an event. Keeps the existing in-voice copy.
 *
 * `emailSubject` enriches email_* rows with the specific send's subject
 * line. Caller looks the subject up by `event.properties.email_send_id`
 * in the EmailSendSummary index (loaded by getContactEmailSends).
 */
export function eventLabel(event: MergedEvent, emailSubject?: string | null): string {
  const p = event.properties
  switch (event.event_type) {
    case 'property_view': {
      const addr  = (p.address as string | undefined) ?? (p.title as string | undefined)
      const verb  = consumptionVerb(event.scroll_pct, 'listing')
      const depth =
        event.scroll_pct !== undefined
          ? event.scroll_pct >= 75
            ? ' — read every detail'
            : event.scroll_pct >= 40
              ? ' — looked it over'
              : ''
          : ''
      const prettyVerb =
        verb === 'spent time on' ? 'Spent time on' :
        verb === 'looked through' ? 'Looked through' : 'Browsed'
      return addr
        ? `${prettyVerb} a listing — ${addr}${depth}`
        : `Viewed a property listing${depth}`
    }
    case 'form_submit': {
      const form = (p.form_name as string | undefined) ?? (p.form_id as string | undefined)
      return form ? `Submitted "${form}"` : 'Sent an enquiry'
    }
    case 'return_visit':
      return 'Came back to your site'
    case 'page_view': {
      const title = typeof p.title === 'string' ? p.title : null
      const pct   = event.scroll_pct
      if (pct !== undefined && pct >= 75) {
        return title ? `Sat with your content — "${title}"` : 'Sat with your content'
      }
      if (pct !== undefined && pct >= 40) {
        return title ? `Spent time on your site — "${title}"` : 'Spent time on your site'
      }
      return title ? `Browsed your site — "${title}"` : 'Browsed your site'
    }

    // ── HOR-106 email events (slice F) ───────────────────────────────────
    case 'email_sent': {
      return emailSubject
        ? `Sent — "${emailSubject}"`
        : 'Sent a tracked email'
    }
    case 'email_opened': {
      const count = event.repeated_count
      const mpp = Boolean(p.apple_mpp)
      const bot = Boolean(p.likely_bot)
      // Apple MPP "opens" are image-proxy prefetches, not a real human read.
      // Surface them distinctly so the agent doesn't read engagement that
      // isn't there.
      if (mpp) {
        return emailSubject
          ? `Image previewed by Apple Mail privacy proxy — "${emailSubject}"`
          : 'Image previewed by Apple Mail privacy proxy'
      }
      if (bot) {
        return emailSubject
          ? `Link prefetched by a scanner — "${emailSubject}"`
          : 'Link prefetched by a scanner'
      }
      const suffix = count && count > 1 ? ` (×${count})` : ''
      return emailSubject
        ? `Opened${suffix} — "${emailSubject}"`
        : `Opened a tracked email${suffix}`
    }
    case 'email_clicked': {
      const url = typeof p.url === 'string' ? p.url : null
      const niceUrl = url ? formatEventUrl(url) : null
      if (emailSubject && niceUrl) return `Clicked ${niceUrl} — "${emailSubject}"`
      if (emailSubject)            return `Clicked a link — "${emailSubject}"`
      if (niceUrl)                  return `Clicked ${niceUrl}`
      return 'Clicked a tracked link'
    }
    case 'email_bounced': {
      const kind = typeof p.bounce_kind === 'string' ? p.bounce_kind : null
      const verb = kind === 'soft_bounced' ? 'Soft bounced' :
                   kind === 'hard_bounced' ? 'Bounced'      :
                   'Bounced'
      return emailSubject
        ? `${verb} — "${emailSubject}"`
        : `${verb} — delivery failed`
    }

    default:
      return event.event_type.replace(/_/g, ' ')
  }
}

export function eventUrl(props: Record<string, unknown>): string | null {
  const raw = props.url ?? props.path
  if (!raw || typeof raw !== 'string') return null
  return raw
}

export function formatEventUrl(raw: string): string {
  try {
    const u = new URL(raw)
    return u.hostname + u.pathname
  } catch {
    return raw
  }
}

/**
 * Bucket event types for the design's timeline filter (All / Visits / Roles+merges / Emails).
 * Email types route to 'email' so the new filter chip can isolate them.
 */
export type TimelineEventKind = 'visit' | 'merge' | 'role' | 'email'

export function eventKind(event: MergedEvent): TimelineEventKind {
  if (event.event_type === 'identity_resolve') return 'merge'
  if (
    event.event_type === 'email_sent' ||
    event.event_type === 'email_opened' ||
    event.event_type === 'email_clicked' ||
    event.event_type === 'email_bounced'
  ) {
    return 'email'
  }
  return 'visit'
}
