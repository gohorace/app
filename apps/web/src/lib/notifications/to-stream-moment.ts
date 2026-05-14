/**
 * Adapter: `notification_log` row (joined to `contacts`) → `StreamMoment`
 * view-model that the MomentCard component renders.
 *
 * Slice A — moment fields the schema doesn't yet carry (headline,
 * editorial, tags, primary CTA copy) are derived here from what we do
 * have: the type-enum, the contact, and the brief's copy guidance.
 * Slice B persists these fields at flag time and this adapter shrinks
 * to a near-passthrough.
 *
 * Filtering: rows whose moment type can't be derived (audit-only,
 * email-channel, missing contact) are dropped before this adapter
 * runs. Callers should filter on `deriveMomentType(...) !== null` first.
 */

import {
  DEFAULT_PRIMARY_BY_TYPE,
  type MomentType,
  type StreamMoment,
} from '@/components/notifications/moment-types'
import { bucketFor, formatTimeAgo } from './bucket'

export interface RawNotificationRow {
  id: string
  type: string
  contact_id: string | null
  title: string | null
  body: string | null
  url: string | null
  sent_at: string
  read_at: string | null
}

export interface RawContactRow {
  id: string
  first_name: string | null
  last_name: string | null
  suburb: string | null
  last_seen_at: string | null
  identified_at: string | null
}

export interface ToStreamMomentInput {
  row: RawNotificationRow
  contact: RawContactRow | null
  momentType: MomentType
  now: Date
  /** Agent timezone — sourced from `agent_settings.timezone`. */
  tz: string | null | undefined
}

const DEFAULT_EDITORIAL_BY_TYPE: Record<MomentType, string> = {
  newly_known:       'Anonymous sessions, now identified. Lead with that.',
  high_intent:       'A strong signal. Worth a look while it&rsquo;s warm.',
  returning:         'Back again. Each visit is a pattern, not a coincidence.',
  worth_watching:    'Engagement is rising. Something is stirring locally.',
  ownership_changed: 'Title transferred. Worth a doorknock note this week.',
}

export function toStreamMoment(input: ToStreamMomentInput): StreamMoment {
  const { row, contact, momentType, now, tz } = input

  const sentAt = new Date(row.sent_at)
  const unread = !row.read_at

  const fullName = [contact?.first_name, contact?.last_name].filter(Boolean).join(' ').trim()
  const displayName = fullName || 'Unknown contact'
  const initials = initialsFor(contact?.first_name, contact?.last_name)
  const suburbBit = contact?.suburb ?? 'Unknown suburb'
  const seenBit = contact?.last_seen_at
    ? `Active ${formatTimeAgo(new Date(contact.last_seen_at), now, tz)}`
    : 'No recent activity'

  return {
    id: row.id,
    type: momentType,
    unread,
    bucket: bucketFor(sentAt, now, tz),
    time: formatTimeAgo(sentAt, now, tz),
    headline: row.title?.trim() || defaultHeadline(momentType, displayName),
    editorial: row.body?.trim() || DEFAULT_EDITORIAL_BY_TYPE[momentType],
    tags: [],
    subject: {
      kind: 'contact',
      id: contact?.id ?? row.contact_id ?? row.id,
      name: displayName,
      initials,
      context: `${suburbBit} · ${seenBit}`,
    },
    primary: DEFAULT_PRIMARY_BY_TYPE[momentType],
  }
}

function defaultHeadline(type: MomentType, name: string): string {
  switch (type) {
    case 'newly_known':
      return `${name} just put a name to it`
    case 'high_intent':
      return `${name} is showing strong intent`
    case 'returning':
      return `${name} is back`
    case 'worth_watching':
      return `Engagement spike worth watching`
    case 'ownership_changed':
      return `Ownership change recorded`
  }
}

function initialsFor(first: string | null | undefined, last: string | null | undefined): string {
  const a = (first || '').trim()[0]
  const b = (last || '').trim()[0]
  if (a && b) return (a + b).toUpperCase()
  if (a) return a.toUpperCase()
  if (b) return b.toUpperCase()
  return '·'
}
