# Design handoff — Outreach Review (the "nudge → drafts" surface)

> Part of the Site Content in Outreach epic ([HOR-383](https://linear.app/gohorace/issue/HOR-383)),
> P5 ([HOR-389](https://linear.app/gohorace/issue/HOR-389)). The functional v1 ships as a standalone
> `/outreach/[contactId]` page; this spec is the **target**: fold it into the email-composer dock
> with a distinct visual mode per channel. No Figma yet — when there is one, tighten measurements +
> variants against it.

## Overview
When a lead's behaviour fires a signal, the agent opens a **nudge** and reviews three ready drafts —
**Email, SMS, Call notes** — grounded in the agent's own matched site content. They swap referenced
content, edit inline, send the email / copy the SMS, and can mute content types. This replaces the
standalone page by **folding into the existing composer dock** so it reads as one comms surface,
with a **distinct visual mode per channel** so the agent always knows which one they're in.

## Layout
- **Shell = the composer dock** (reuse `composer-dock.tsx`, HOR-354): modeless, **420 px** floating
  panel, bottom-right on desktop; **full-width bottom sheet** on mobile (<768 px). Stacks left of any
  open dock; clears the Companion.
- **Vertical order inside the dock:**
  1. Header: pretext line + mode switcher + close
  2. Content-reference strip (matched listings/sold/report + swap)
  3. Active mode panel (Email / SMS / Call notes)
  4. Footer action bar (mode-specific: Send / Copy / —)
  5. Collapsible "Never insert" mutes (secondary, tucked at the bottom)

## Design tokens used (from the live theme)
| Token | Usage |
|---|---|
| `--bg-surface` | dock background, cards |
| `--bg-elevated` | active segment, raised controls |
| `--border-subtle` | card + input borders |
| `--fg-primary` / `--fg-secondary` | body text / labels & meta |
| `--shadow-sm` / `--shadow-xs` | dock / active segment elevation |
| `--color-terracotta` (`#C4622D`), tint `rgba(196,98,45,0.1)` | accent: links, primary action, content-icon chip |
| segment track `rgba(140,123,107,0.1)` | mode-switcher track |
| `--radius-md` (5–6 px) | inputs, segments, cards |

## Mode switcher — the per-mode distinction
Reuse `<Segmented>` for the control, but give each mode a **carry-through accent** so the whole
panel signals the channel:

| Mode | Icon | Accent | Footer action |
|---|---|---|---|
| **Email** | `Mail` | terracotta (primary) | **Send email** (solid) |
| **SMS** | `MessageSquare` | a cool secondary (e.g. sage/blue token) | **Copy** (ghost) + char counter |
| **Call notes** | `Phone` | neutral/"internal" grey, subtle bordered container | *no send* — view-only |

The active panel's left accent bar / header tint uses the mode accent. Call notes deliberately reads
as an **internal document** (muted, bordered), not a sendable message.

## Components
| Component | Variant / props | Notes |
|---|---|---|
| Dock shell | reuse composer dock | one open at a time per contact |
| Pretext line | caption | "Reasoned from {pretext_label}" — `--fg-secondary`, 12 px. Trust line; never references behaviour. |
| Mode switcher | `Segmented` + icons + accent | 3 segments, always all present |
| Content-reference row | repeatable | icon chip (terracotta tint) + content label as a link + **Swap** affordance |
| Swap control | dropdown/popover | lists up to 4 alternatives (top-5 total); select → re-features inline, no reload |
| Subject field | `Input` | single line |
| Body field | `textarea` | auto-grow, min 180 px; inherits font |
| SMS field | `textarea` | min 90 px + live char counter (target ≤160) |
| Call-notes: spoken opener | read-only card | the only lead-facing call text |
| Call-notes: reference context | read-only, "internal" styling | **explicit** about the signal — label "Your eyes only / never say this to the lead" |
| Mute row | `Switch` ×3 | Listings / Sold results / Suburb reports |
| Send button | `Button` solid | Email only |
| Copy button | `CopyButton` | SMS only |

## States and interactions
| Element | State | Behavior |
|---|---|---|
| Dock | Loading | "Drafting…" skeleton (drafts are pre-generated, so brief; skeleton not spinner) |
| Mode segment | Active | `--bg-elevated` + `--shadow-xs` + mode accent text; inactive = `--fg-secondary`, hover → `--fg-primary` |
| Content link | Hover | underline; opens `source_url` in new tab |
| Swap | Open | popover of alternatives; selecting swaps the featured item + link in place |
| Send (email) | idle→sending→sent | label cycles "Send email" → "Sending…" (disabled) → "Sent ✓" (disabled); error → inline red "Send failed — try again" |
| Copy (SMS) | clicked | "Copied ✓" 2.5 s, then reverts |
| Mute | toggle | optimistic flip → POST `/api/outreach/mutes` → **re-fetch drafts** (muted type disappears) |

## Responsive
| Breakpoint | Changes |
|---|---|
| Desktop (>768 px) | 420 px dock, bottom-right |
| Mobile (<768 px) | full-width bottom sheet; mode switcher full-width; action bar pinned to bottom safe-area |

## Edge cases (the brief's trust moments)
- **No matched content** → reference strip: *"No fresh matching content for {suburb} — drafts lead
  with the pretext only (nothing unrelated inserted)."* Email still present (pretext-only); SMS panel
  shows empty state "No fresh link to share."
- **Firewall held / model unavailable** → Email panel empty state: *"Couldn't draft a clean email for
  this one — the call notes still have the context."* **Call notes always render** (templated, never empty).
- **Dead link dropped at send-time** → JIT verify may drop a 404/sold item vs. what was pre-generated.
  Quiet note: *"One item was just removed — it's no longer live."*
- **Long content label / address** → truncate with ellipsis at one line; full text on hover/title.
- **Long body** → textarea grows; dock scrolls internally, header + action bar stay pinned.

## Animation / motion
| Element | Trigger | Animation | Duration | Easing |
|---|---|---|---|---|
| Dock | open | slide-up + fade | 180 ms | ease-out |
| Mode switch | select | accent/underline slide | 150 ms | ease-in-out |
| Swap popover | open | fade + 4 px rise | 120 ms | ease-out |
| Send success | sent | checkmark fade-in | 150 ms | ease-out |

## Accessibility
- Mode switcher: `role="tablist"`, each segment `role="tab"` + `aria-selected`; panels
  `role="tabpanel"` + `aria-labelledby`.
- Focus order: pretext → mode switcher → content/swap → active field(s) → primary action → mutes.
- Send/Copy announce state changes (`aria-live="polite"` on "Sent ✓" / "Copied ✓").
- Call-notes "internal / never say to lead" conveyed to screen readers, not just colour — visible label.
- Mute switches labelled, keyboard-toggleable; toggling announces the result.

## Open design decisions
1. **Mode layout** — segmented switcher (recommended, current) vs. stacked sections vs. accordion.
2. **Per-mode accent palette** — need a secondary (SMS) + neutral (call notes) token alongside terracotta.
3. **Swap UX** — inline popover of 5 (current) vs. a fuller "more options" drawer.
4. **Mute placement** — collapsed at dock bottom (recommended) vs. a settings-level global control.
5. **Entry point** — where does the dock open from? (digest signal-card "Draft outreach" action is the
   queued follow-up.)

## Reference — the shipped functional v1
- Component: `apps/web/src/components/outreach/outreach-review.tsx`
- Page: `apps/web/src/app/(dashboard)/outreach/[contactId]/page.tsx`
- Drafts API: `POST /api/outreach/drafts` · Mutes API: `GET|POST /api/outreach/mutes`
- Reused primitives: `Segmented`, `Switch`, `CopyButton`, `EmptyState`, `Button`, `Input`
