# Design sources of truth

When a design file and a written brief disagree, **the design wins**. Briefs
document intent and decisions; designs encode the final shape. If the design
ships before the brief is updated, follow the design — and flag the brief
drift in your PR description so it gets reconciled.

## Where designs live

Until we have a Figma-export-to-repo pipeline, designs ship as zipped
reference bundles. Andy drops them in `~/Downloads/Horace <Surface>.zip`
and shares the path in the kickoff message for a slice. Each bundle
contains:

- `*.html` — rendered design canvas (open in a browser for the final visual)
- `*.jsx` — the component JSX that makes the canvas (open in your editor —
  this is the source of truth for layout, palette, copy, micro-interaction)
- `assets/` — image and font references
- `colors_and_type.css` — the design system tokens

**During implementation, keep the relevant `.jsx` file open side-by-side
with the brief.** When something is in both: defer to the design. When
something is in the design but not the brief: implement it unless it's
explicitly deferred. When something is in the brief but not the design:
ask before implementing.

## Locked design patterns

Patterns the design has settled. If a brief contradicts one of these, the
design still wins — update the brief.

| Pattern | Locked as | Source |
|---|---|---|
| Signal card actions | **Stacked: primary `Add to list` on top, secondary `More` below** — both right-aligned in the card. Overrides earlier "primary + overflow" wording. | HOR-124 review, 2026-05-14 |
| Digest desktop shell | **Three-column: sidebar · main column (left-anchored, `max-width: 760`) · right rail (`width: 280`, hidden below `lg`)** | HOR-124 review, 2026-05-14 |
| Anon-becomes-known card | **Banner inside card boundary + terracotta-tinted background + `Newly known` pill** | HOR-124 review, 2026-05-14 |
| Guidance copy modes | **`ADVISORY` (terracotta), `CONTEXTUAL` (stone), `TIME-SENSITIVE` (terracotta-dark)** as small-caps eyebrows above the italic nudge line | Digest canvas — `screens.jsx::GUIDANCE` |
| Demo / review mode gating | **`?demo=1` query param, allowed only when `process.env.VERCEL_ENV !== 'production'`** | HOR-124 review, 2026-05-14 |
| Sidebar IA | **Today / Data (Contacts + Properties) / Notifications / Account.** `/dashboard` retired, redirects to `/digest`. Help + Import moved into Settings menu items. | HOR-123, merged in PR #51 |

## Implementation process

1. Read the brief for the slice (Linear issue + the parent epic).
2. Open the relevant `.jsx` design file alongside it.
3. Implement against the design. Where the brief is silent or stale,
   default to the design.
4. List any discrepancies in the PR description so the brief gets
   reconciled before the next slice picks them up.
5. After merge, if a new pattern was locked, add a row to the **Locked
   design patterns** table above.

## Shared design primitives in code

Once a slice introduces a primitive used across surfaces, every subsequent
surface should import from it rather than duplicate. Current primitives:

| Primitive | Path | Introduced |
|---|---|---|
| Intent palette (`high` / `mid` / `low`) + guidance modes | `apps/web/src/lib/design/intent.ts` | HOR-124 |
| `IntentBadge`, `GuidanceBadge` | `apps/web/src/components/digest/` | HOR-124 |

Planned (per the V1 plan):

| Primitive | Path | Slice |
|---|---|---|
| `IdentityGradient`, `RoleBadge`, `EngagementIndicator`, `PersonAvatar`, `PropertyThumbStack` | `apps/web/src/lib/design/badges.tsx` | HOR-125 |

## Open follow-ups

- **Repo-checked designs.** The zip-in-Downloads flow makes designs hard
  to discover months later. Future state: design exports land in
  `apps/web/design/` (or a `design/` package) as part of the design
  handoff, version-controlled. Worth a separate chore once the V1 push
  is done.
- **Design-system extraction.** As more primitives stabilise, lift
  `apps/web/src/lib/design/` and `apps/web/src/components/digest/`
  (where shared) into a dedicated `@horace/design` package so other
  apps (tracker, future native) can consume them.
