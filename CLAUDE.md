# Horace — Project context for Claude Code

This file is loaded automatically every session. Keep it short. Detailed material lives in `docs/` and gets pulled in only when relevant.

If a decision in here conflicts with what you find in code, **flag it before silently resolving** — usually this doc is right, but not always.

---

## Hard rules (non-negotiable)

1. **Data sovereignty.** Every architectural choice must hold up against *"can the agent leave with their data tomorrow?"* If the answer is no, stop and surface it.
2. **No CRM features.** No notes against contacts, no deal stages, no follow-up tasks. If a request adds these, flag it as a positioning concern before building.
3. **MCP-readiness is a V1 constraint.** MCP doesn't ship in V1, but the data model must be designed as if it ships in V1.5.
4. **Shared surfaces share components.** Today's Digest, Notifications, Properties, and Contacts deliberately reuse the engagement indicator, side pane, and contact-action affordances. Build once, use in all four.

---

## Repo layout

- `apps/web` — Next.js app (the thing users see)
- `apps/tracker` — engagement tracking surface
- `supabase/migrations` — schema. See [memory note on migration drift](../.claude/projects/-Users-andytwomey-code/memory/horace_migration_tracking_drift.md) — `_migrations` table stops at 2026-04-29; reconcile before any new `db push`.
- `docs/` — see routing below
- `scripts/` — workspace tooling

---

## Doc routing

Read the relevant doc for the task before starting work. Don't load everything.

| If you're working on… | Read |
| - | - |
| Alert / notification copy | [docs/alerts-copy-standards.md](docs/alerts-copy-standards.md) |
| Auditing existing alerts | [docs/alerts-audit.md](docs/alerts-audit.md) |
| Anything that touches design references | [docs/design-sources.md](docs/design-sources.md) |
| Inbound email infra | [docs/adr/0001-inbound-email-infrastructure.md](docs/adr/0001-inbound-email-infrastructure.md) |
| Outbound email / "brief isn't arriving" | [docs/email-deliverability.md](docs/email-deliverability.md) |
| Suburb boundary polygons / choropleth data | [docs/sal-boundaries.md](docs/sal-boundaries.md) |

**Planned but not yet written** (don't pretend they exist — flag if a task needs them):
`docs/data-architecture.md`, `docs/mcp-readiness-checklist.md`, `docs/tech-stack.md`, and feature briefs under `docs/briefs/` (digest, notifications, properties, contacts).

---

## Handoff format

When you finish a unit of work and hand it back to me, use this shape. The point is that I can decide in 30 seconds whether to smoke-test now or come back later, and I know exactly what to click.

```
HOR-### — PR #N: <github url>

What lands:
- <shipped piece, scannable>
- <shipped piece, scannable>
- …

Implementation note: <one paragraph, only if you took a non-obvious shortcut,
collapsed scope, or made a call that future-me will wonder about. Skip
this section entirely if the change is straightforward.>

Smoke path once the build's green:
1. <click-by-click step>
2. <click-by-click step>
3. …
```

Rules:

- **Header line is mandatory** — ticket ID, PR number, full URL. No bare `PR #N`.
- **"What lands" is bullets, not prose.** Each bullet is one shipped piece, ideally with the route/component it touches in `code voice`.
- **Implementation note is opt-in.** Include it only when you did something I wouldn't predict from the bullets (scope collapse, library swap, deferred follow-up). If everything was obvious, leave the section out — don't pad.
- **Smoke path is numbered, click-by-click.** Start from a known surface ("Sidebar Lists →"), state the expected result of each step ("grid scoped to high-intent contacts, banner reads `Built-in · …`"). I should be able to follow it without re-reading the PR.
- If a background poll / deploy is running, mention it on the last line so I know to wait.

Don't bury decisions in commit messages. If something is worth me knowing in three weeks, it goes in the relevant doc — not just the handoff.

---

## Open engineering questions (don't resolve silently)

- Property data vendor (CoreLogic / Domain / PropTrack / other)
- Site engagement → property mapping across agent sites
- Identity resolution thresholds (auto-merge vs suggested merge)
- Push-permission timing in onboarding

If a task forces a call on any of these, surface it before building.
