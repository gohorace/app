/**
 * Scripted per-turn copy for the agentic onboarding shell.
 *
 *   • Every string in `horace` is voiced as Horace (first person,
 *     conversational, AU-tuned). Tests in copy.test.ts enforce the
 *     alerts-copy-standards rules: no exclamation marks, no emoji, no
 *     banned terms ("territory", "realtor", "valuation", …), no SaaS-
 *     speak in Horace's mouth ("leverage", "unlock", "powerful",
 *     "seamless", "alert"), and the sign-off "Seize the moment" appears
 *     only in T7.
 *   • Strings in `ui` are button labels / chips / placeholders — not
 *     Horace's voice — and are NOT subject to the Horace rules. They
 *     can use the literal word "dashboard" in a CTA, for example.
 *
 * Functions, not template literals, so interpolation is type-checked
 * and every call site is grep-able.
 */

// ─────────────────────────────────────────────────────────────────────
// Horace's voice
// ─────────────────────────────────────────────────────────────────────

export const horace = {
  // Turn 0 — intro
  t0_intro_a: (): string => "G'day. I'm Horace.",
  t0_intro_b: (): string =>
    "I'll get myself set up while we talk — your details, your site, " +
    "your patch, your contacts. Takes a few minutes. I'll do most of " +
    'the work.',

  // Turn 1 — greet (signup already captured first/last/agency/mobile)
  t1_greet: (firstName: string | null): string =>
    firstName ? `Got it, ${firstName}.` : 'Got it.',
  t1_greet_sub: (): string =>
    "I won't ring or message unless it's worth your time.",

  // Turn 2 — tracking script
  t2_suggest_site: (host: string): string =>
    `Looks like you're at ${host} — that right?`,
  t2_ask_site: (): string => "What's the URL of your site?",
  t2_found_site: (): string => 'Found it.',
  t2_snippet_intro: (): string =>
    "Drop this on your site once and I'll start reading the moment it lands.",
  t2_help_offer: (): string =>
    "Not the one who installs scripts? Send it to whoever does, or grab 15 minutes with me and we'll do it together.",
  t2_tracking_confirmed: (): string => "Snippet's live. I'm listening.",

  // Turn 7 — sign-off (the only place "Seize the moment" appears)
  t7_signoff: (): string => 'Seize the moment — Horace',
} as const

// ─────────────────────────────────────────────────────────────────────
// UI labels — button text, placeholders, chips.
// Not voiced as Horace; not subject to the voice rules.
// ─────────────────────────────────────────────────────────────────────

export const ui = {
  letsGo: 'Let’s go',
  useClassic: 'Use the classic setup instead',
  bailPromptHeading: 'Want to use the classic setup instead?',
  bailPromptCta: 'Take me to the classic setup',
  takeMeToDashboard: 'Take me to my dashboard',
} as const

// ─────────────────────────────────────────────────────────────────────
// Voice-test helpers (exported for copy.test.ts).
// ─────────────────────────────────────────────────────────────────────

/** Banned tokens that must not appear in any horace.* string output.
 *  Sources:
 *    • docs/alerts-copy-standards.md AU swap table (left = use,
 *      right = banned).
 *    • The brief's "no SaaS-speak" list.
 *  Matched case-insensitively as whole words. */
export const BANNED_IN_HORACE: readonly string[] = [
  // AU swap table — never the right-hand column
  'valuation',
  'territory',
  'region',
  'neighborhood',
  'neighbourhood',
  'district',
  'comps',
  'comparables',
  'realtor',
  'broker',
  'inquiry',
  'tracking',
  'monitoring',
  // Brief's SaaS-speak ban (Horace's voice; "dashboard" is fine in ui.*)
  'leverage',
  'unlock',
  'powerful',
  'seamless',
  'dashboard',
  'alert',
  'alerts',
] as const

/** All Horace-voice functions, for iteration in tests. Each entry is a
 *  representative invocation that exercises every public branch of the
 *  function. Add new entries here when you add new horace.* exports. */
export const HORACE_SAMPLES: ReadonlyArray<{ key: string; value: string }> = [
  { key: 't0_intro_a', value: horace.t0_intro_a() },
  { key: 't0_intro_b', value: horace.t0_intro_b() },
  { key: 't1_greet:with-name', value: horace.t1_greet('Davey') },
  { key: 't1_greet:no-name', value: horace.t1_greet(null) },
  { key: 't1_greet_sub', value: horace.t1_greet_sub() },
  { key: 't2_suggest_site', value: horace.t2_suggest_site('reidproperty.com.au') },
  { key: 't2_ask_site', value: horace.t2_ask_site() },
  { key: 't2_found_site', value: horace.t2_found_site() },
  { key: 't2_snippet_intro', value: horace.t2_snippet_intro() },
  { key: 't2_help_offer', value: horace.t2_help_offer() },
  { key: 't2_tracking_confirmed', value: horace.t2_tracking_confirmed() },
  { key: 't7_signoff', value: horace.t7_signoff() },
]

/** The single permitted occurrence of "Seize the moment". Tests assert
 *  the phrase appears here and nowhere else. */
export const SIGNOFF_KEY = 't7_signoff'
