/**
 * Event-rendering helpers shared by the contact detail page and any
 * future surface that renders a behavioural timeline (e.g. property
 * detail in HOR-126).
 *
 * Lifted from apps/web/src/app/(dashboard)/contacts/[id]/page.tsx as part
 * of HOR-125 so the detail page rewrite doesn't duplicate this logic.
 */

export type RawEvent = {
  id: string
  event_type: string
  properties: Record<string, unknown>
  score_delta: number
  occurred_at: string
}

export type MergedEvent = RawEvent & { scroll_pct?: number }

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

function consumptionVerb(pct: number | undefined, type: 'page' | 'listing'): string {
  if (pct === undefined) return 'browsed'
  if (pct >= 75) return type === 'listing' ? 'spent time on' : 'sat with'
  if (pct >= 40) return type === 'listing' ? 'looked through' : 'spent time on'
  return 'browsed'
}

/**
 * Horace-voiced label for an event. Keeps the existing in-voice copy.
 */
export function eventLabel(event: MergedEvent): string {
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
 * Bucket event types for the design's timeline filter (All / Visits / Roles+merges).
 * "Roles+merges" reads from metadata.roles for role events; live event types
 * are all considered "visits" except identity-resolution events.
 */
export type TimelineEventKind = 'visit' | 'merge' | 'role'

export function eventKind(event: MergedEvent): TimelineEventKind {
  // Identity merge events would land here once identity_map writes events.
  // For now, every live event is a "visit". Role events come from a different
  // source (contact.metadata.roles).
  if (event.event_type === 'identity_resolve') return 'merge'
  return 'visit'
}
