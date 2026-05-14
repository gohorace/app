/**
 * Canonical fixtures for the Notifications stream — used by the
 * `?demo=1&state=…` design-review affordance on `/notifications`.
 *
 * The eight moments below are ported verbatim from the approved design
 * mock at `/tmp/horace_notif_design/notification-stream.jsx` (lines
 * 16–78). They cover all five moment types, both subject kinds
 * (contact + property), one batched stack, and a mix of read/unread.
 *
 * Gated on `VERCEL_ENV !== 'production'` at the page level — production
 * deploys never see this data, regardless of URL.
 */

import type { StreamMoment } from './moment-types'

export const FIXTURE_MOMENTS: StreamMoment[] = [
  // TODAY
  {
    id: 'm1',
    type: 'high_intent',
    unread: true,
    bucket: 'today',
    time: '12m',
    headline: 'Sarah Thompson got close to a contact form',
    editorial: 'Hovered, hesitated, drifted away. They were that close to picking up the phone.',
    tags: ['Near-submit', 'Returning'],
    subject: {
      kind: 'contact',
      id: 'c-sarah',
      initials: 'ST',
      name: 'Sarah Thompson',
      context: 'Paddington · Active 2h ago',
    },
    primary: 'Add to list',
  },
  {
    id: 'm2',
    type: 'newly_known',
    unread: true,
    bucket: 'today',
    time: '38m',
    headline: "Someone you've been watching just put her name to it",
    editorial: 'Two weeks of anonymous sessions, now identified. Lead with that.',
    tags: ['Newly identified'],
    subject: {
      kind: 'contact',
      id: 'c-lila',
      initials: 'LO',
      name: 'Lila Okafor',
      context: 'Newtown · Identified 38m ago',
    },
    primary: 'View contact',
  },
  {
    id: 'm3',
    type: 'returning',
    unread: true,
    bucket: 'today',
    time: '1h',
    headline: 'Marcus Bell is back — third time this week',
    editorial: "Each visit longer than the last. He isn't browsing anymore.",
    tags: ['Returning', 'Sold results'],
    subject: {
      kind: 'contact',
      id: 'c-marcus',
      initials: 'MB',
      name: 'Marcus Bell',
      context: 'Glebe · Active 1h ago',
    },
    primary: 'Add to list',
    stack: {
      count: 2,
      headlines: ['Marcus revisited the appraisal page', 'Marcus opened the weekly digest'],
    },
  },
  {
    id: 'm4',
    type: 'worth_watching',
    unread: false,
    bucket: 'today',
    time: '3h',
    headline: 'Engagement spike on 47 Maple Street',
    editorial: 'Three new visitors in the last hour. Something local just stirred.',
    tags: ['Property'],
    subject: {
      kind: 'property',
      id: 'p-maple-47',
      address: '47 Maple Street',
      context: 'Surry Hills · 12 visits today',
    },
    primary: 'Add to Watching',
  },
  {
    id: 'm5',
    type: 'ownership_changed',
    unread: false,
    bucket: 'today',
    time: '5h',
    headline: 'New owners just moved into 12 Linden Avenue',
    editorial: 'Title transferred yesterday. Worth a doorknock note this week.',
    tags: [],
    subject: {
      kind: 'property',
      id: 'p-linden-12',
      address: '12 Linden Avenue',
      context: 'Annandale · Settled May 13',
    },
    primary: 'Add to Watching',
  },

  // YESTERDAY
  {
    id: 'm6',
    type: 'high_intent',
    unread: false,
    bucket: 'yesterday',
    time: 'Yesterday',
    headline: 'Hannah Wei read the appraisal page for 14 minutes',
    editorial: "Quietly thorough. The kind of read you don't do casually.",
    tags: ['Appraisal'],
    subject: {
      kind: 'contact',
      id: 'c-hannah',
      initials: 'HW',
      name: 'Hannah Wei',
      context: 'Camperdown · Active 1d ago',
    },
    primary: 'Add to list',
  },
  {
    id: 'm7',
    type: 'returning',
    unread: false,
    bucket: 'yesterday',
    time: 'Yesterday',
    headline: 'Daniel Rocha came back after a week away',
    editorial: 'First session since Tuesday. Picked up where he left off.',
    tags: ['Returning'],
    subject: {
      kind: 'contact',
      id: 'c-daniel',
      initials: 'DR',
      name: 'Daniel Rocha',
      context: 'Redfern · Active 1d ago',
    },
    primary: 'Add to list',
  },
  {
    id: 'm8',
    type: 'worth_watching',
    unread: false,
    bucket: 'yesterday',
    time: 'Yesterday',
    headline: 'Quiet engagement on 7 Park Road',
    editorial: 'Same visitor, three sessions. Worth a name.',
    tags: [],
    subject: {
      kind: 'property',
      id: 'p-park-7',
      address: '7 Park Road',
      context: 'Paddington · 5 visits',
    },
    primary: 'Add to Watching',
  },
]

export type FixtureScenario = 'default' | 'unread' | 'caught' | 'resolved' | 'empty'

/**
 * Apply a scenario to the fixture cast. Returns the (mutated copies of)
 * moments to render, plus the set of `resolvedIds` to feed the stream.
 */
export function buildScenario(scenario: FixtureScenario): {
  items: StreamMoment[]
  resolvedIds: Set<string>
} {
  if (scenario === 'empty') return { items: [], resolvedIds: new Set() }

  const items = FIXTURE_MOMENTS.map((m) => {
    let unread = m.unread
    if (scenario === 'unread') unread = true
    if (scenario === 'caught') unread = false
    return { ...m, unread }
  })

  const resolvedIds = scenario === 'resolved' ? new Set(['m1']) : new Set<string>()
  return { items, resolvedIds }
}
