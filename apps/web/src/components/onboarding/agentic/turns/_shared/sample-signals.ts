/**
 * Sample signals rendered on:
 *   • v1 reveal (components/onboarding/step-reveal.tsx)
 *   • v2 Turn 7 live (components/onboarding/agentic/turns/turn-7-live.tsx)
 *
 * Lived inline in step-reveal.tsx until HOR-212 — extracted here so
 * both surfaces stay character-identical. The three personas show
 * the full intent spectrum (high / mid / watching) and what Horace's
 * voice reads like once real signals start landing.
 *
 * Voice: passes the same alerts-copy-standards bar as the live
 * push/email surfaces. If you edit a nudge here, run it through the
 * checklist in docs/alerts-copy-standards.md before merging.
 */

export interface SampleSignal {
  name: string
  initials: string
  intent: 'high' | 'mid' | 'low'
  intentLabel: string
  nudge: string
  meta: string
}

export const SAMPLES: SampleSignal[] = [
  {
    name: 'Sarah Thompson',
    initials: 'ST',
    intent: 'high',
    intentLabel: 'High intent',
    nudge: '“Sarah’s back three times this week. Appraisal page, twice. Worth a call.”',
    meta: '2h ago · Sample',
  },
  {
    name: 'David Nguyen',
    initials: 'DN',
    intent: 'mid',
    intentLabel: 'Mid intent',
    nudge: '“Something’s stirring on Maple Street. Browsing sold results — classic pre-appraisal.”',
    meta: 'Yesterday · Sample',
  },
  {
    name: 'Claire Adeyemi',
    initials: 'CA',
    intent: 'low',
    intentLabel: 'Watching',
    nudge: '“Downloaded the suburb report. Still early — worth keeping an eye on.”',
    meta: '3 days ago · Sample',
  },
]
