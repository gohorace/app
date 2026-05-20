/**
 * HOR-251 — static support config for v2.0.
 *
 * Links + the status strip are hard-coded here for now. A live status
 * feed (status.gohorace.com or a Supabase incidents row) is HOR-261
 * (v2-D8) — when it lands, `status` becomes a fetch and the rest of the
 * SupportView stays unchanged.
 */

export interface SupportGuide {
  title: string
  sub: string
  /** Internal route — all guides currently land on the /help stub. */
  href: string
}

export const SUPPORT_GUIDES: SupportGuide[] = [
  { title: 'Reading your daily digest', sub: 'Three minutes — what to act on, what to skip.', href: '/help' },
  { title: 'Setting up an inspection', sub: 'QR, sign-in flow, and the post-visit follow up.', href: '/help' },
  { title: 'How intent scoring works', sub: 'The points behind warm / active / stirring.', href: '/help' },
  { title: 'Inviting your team', sub: 'Roles, seats, and what your assistant can see.', href: '/help' },
]

export interface SupportChannelDef {
  icon: 'mail' | 'chat' | 'calendar'
  title: string
  sub: string
  cta: string
  /** mailto: / external URL the CTA opens. */
  href: string
  external?: boolean
}

export const SUPPORT_EMAIL = 'support@gohorace.com'

export const SUPPORT_CHANNELS: SupportChannelDef[] = [
  {
    icon: 'mail',
    title: 'Email the team',
    sub: `${SUPPORT_EMAIL} — replies within one business day.`,
    cta: 'Open mail',
    href: `mailto:${SUPPORT_EMAIL}`,
  },
  {
    icon: 'chat',
    title: 'Live chat',
    sub: 'Mon–Fri, 9am–5pm AEST.',
    cta: 'Start chat',
    // Placeholder until a real chat widget is wired (product decision).
    href: `mailto:${SUPPORT_EMAIL}?subject=Live%20chat%20request`,
  },
  {
    icon: 'calendar',
    title: 'Book a 1:1',
    sub: '20 minutes with someone on the team — pricing, setup, or a deep look at your account.',
    cta: 'Pick a time',
    href: 'https://calendly.com/gohorace/intro',
    external: true,
  },
]

export interface SupportStatus {
  /** 'quiet' renders the moss pulse + "All systems quiet." */
  level: 'quiet' | 'investigating' | 'outage'
  headline: string
  detail: string
  pageUrl: string
}

export const SUPPORT_STATUS: SupportStatus = {
  level: 'quiet',
  headline: 'All systems quiet.',
  detail: 'Last incident: 4 weeks ago.',
  pageUrl: 'https://status.gohorace.com',
}
