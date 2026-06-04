/**
 * Static UI copy for the /audit experience. Finding copy is generated from real
 * metrics server-side (see lib/audit/findings.ts) and arrives via the API — only
 * the surrounding chrome lives here. All copy is final, in Horace's voice.
 */

import type { Band } from '@/lib/audit/types'

export const COPY = {
  input: {
    headline: "How's your site actually doing?",
    subhead:
      "I'll have a look in 60 seconds — speed, mobile, forms, tracking, and the basics.",
    placeholder: 'yourdomain.com.au',
    cta: 'Have a look',
    reassurance: 'Free. No login. No catch.',
    invalid: "That doesn't look like a real URL — want to try again?",
    unreachable: "I can't see your site right now. Is the URL right?",
    timeout: 'Taking longer than usual. Hold tight — or refresh and try again.',
  },

  loading: {
    lead: "Hold on, I'm having a look at",
    final: 'Almost done.',
    // Scripted narration weights (relative durations); the real audit runs in
    // parallel and gates the hand-off to the report.
    checks: [
      { id: 'speed', label: 'Checking how fast your site loads', weight: 30, done: 'Speed check complete' },
      { id: 'mobile', label: 'Checking how it holds up on mobile', weight: 6, done: 'Mobile check complete' },
      { id: 'forms', label: 'Counting your form fields', weight: 9, done: 'Forms check complete' },
      { id: 'tracking', label: 'Looking at what tools are watching', weight: 3, done: 'Tracking check complete' },
      { id: 'discovery', label: 'Reading your headings', weight: 3, done: 'Discovery check complete' },
    ],
  },

  report: {
    openerLine: "Here's what I noticed.",
    opener:
      'Five things I can measure cleanly: how fast it loads, how it holds up on mobile, how your forms are built, what tools are watching, and whether search engines can read it properly.',
    verdictLine: "Here's what to do about it.",
    allGoodOpener:
      "Your site is in good shape. Here's what I found anyway — even great sites have room to sharpen.",

    topThreeLabel: 'If you do nothing else this month, fix these',
    topThreeFooter: "Detail's below.",

    humanEyeLabel: "Three things I didn't audit, because they need a human eye",
    humanEye: ['Your design quality.', 'Your information architecture.', 'Your brand.'],
    humanEyeBody:
      'These three matter as much as the five I measured. If you want a proper look, we can do that — just ask.',

    partialNote:
      "A couple of checks I couldn't read cleanly this time — they're marked below. The rest is solid.",

    capture: {
      prompt:
        'Want the full report as a PDF, plus the playbook that shows you how to fix all of this?',
      placeholder: 'your@email.com',
      cta: 'Send it to me',
      emailErr: 'That email looks off — mind checking it?',
      sendErr: 'Couldn’t send that — try once more?',
    },

    share: { idle: 'Copy a link to this report', done: 'Link copied' },
    signature: 'Seize the moment — Horace',
  },

  confirmation: {
    headline: 'Sent. Check your inbox in a minute or two.',
    secondary:
      "While you're waiting — the playbook goes deeper on every finding above.",
    primary: { label: 'Book a walk-through', href: '/contact' },
    secondaryCta: { label: 'Read the playbook', href: '/manifesto' },
  },
} as const

export const BAND_LABEL: Record<Band, string> = {
  fix: 'Fix this first',
  watch: 'Worth a look',
  good: 'Looking good',
}

/** Page-local band tokens (defined in audit.module.css under `.bandFix` etc). */
export const BAND_VAR: Record<Band, string> = {
  fix: 'var(--band-fix)',
  watch: 'var(--band-watch)',
  good: 'var(--band-good)',
}
