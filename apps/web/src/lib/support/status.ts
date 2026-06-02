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
  /** Full URL of the Help Centre article (opens in a new tab). */
  href: string
}

/** Root of the Featurebase-hosted Help Centre, linked beneath the guides. */
export const HELP_CENTRE_URL = 'https://gohorace.featurebase.app/en/help'

export const SUPPORT_GUIDES: SupportGuide[] = [
  {
    title: 'Getting started with Horace',
    sub: 'Snippet, markets, contacts, alerts — the first ten minutes.',
    href: 'https://gohorace.featurebase.app/en/help/articles/2473480-getting-started-with-horace',
  },
  {
    title: 'Your Stream — the day’s signals',
    sub: 'What to act on, what to skip, in priority order.',
    href: 'https://gohorace.featurebase.app/en/help/articles/8938980-your-stream-the-days-signals',
  },
  {
    title: 'Market — the suburb view',
    sub: 'Read signal strength across suburbs before leads surface.',
    href: 'https://gohorace.featurebase.app/en/help/articles/9973686-market-the-suburb-view',
  },
  {
    title: 'Reaching out — tracked email, SMS, and links',
    sub: 'Send, schedule, and see what lands.',
    href: 'https://gohorace.featurebase.app/en/help/articles/7585477-reaching-out-tracked-email-sms-and-links',
  },
]

export interface SupportChannelDef {
  icon: 'mail' | 'chat' | 'calendar'
  title: string
  sub: string
  cta: string
  /** mailto: / external URL the CTA opens (also the fallback when the
   *  Featurebase messenger isn't configured). */
  href: string
  external?: boolean
  /** When set, the CTA opens `href` in an in-app modal (cal.com embed) rather than navigating away. */
  embed?: boolean
  /** When true, the CTA opens the Featurebase messenger instead of `href`,
   *  provided NEXT_PUBLIC_FEATUREBASE_APP_ID is set. Falls back to `href`. */
  messenger?: boolean
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
    // Opens the Featurebase messenger when configured; otherwise falls back
    // to this mailto.
    href: `mailto:${SUPPORT_EMAIL}?subject=Live%20chat%20request`,
    messenger: true,
  },
  {
    icon: 'calendar',
    title: 'Book a 1:1',
    sub: '20 minutes with someone on the team — pricing, setup, or a deep look at your account.',
    cta: 'Pick a time',
    href: 'https://cal.com/andytwomey/support-session',
    embed: true,
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
  pageUrl: 'https://horace.instatus.com',
}
