# Properties — Feature brief

> **Status:** Live, expanded through the HOR-215 epic (May 2026). This brief is the durable reference; PR descriptions and the implementation plan at `~/.claude/plans/tranquil-stirring-pond.md` carry the day-to-day decisions.

The Properties surface is the agent's view onto their **patch**: every address they hold, every signal those addresses are emitting, the contacts circling them, and what Horace thinks is shifting. It's one of the four shared surfaces called out in the root [`CLAUDE.md`](../../CLAUDE.md) — Digest, Notifications, Properties, Contacts — that reuse the engagement indicator, side pane, and contact-action affordances.

## What ships today

Two presentations of one signal model:

- **List view** — table of properties sorted by `last_activity_at desc`. Engagement column, linked-contact avatar stack, secondary filters (intensity, time window, suburb, street, linked/unlinked, contact-name search). Each row's suburb cell carries a small **suburb-signal pill** when the suburb is warm / hot / stirring.
- **Map view** — Google Maps wrapper with four signal layers on top of the base:
  1. **Heat layer** — recency-weighted intensity across the workspace's properties.
  2. **Suburb labels** — DM Mono for quiet suburbs, Playfair serif for warm / hot / stirring. Stirring suburbs carry an animated terracotta pulse-dot.
  3. **Property pins** — three tiers (quiet / active / hot) differentiated by size, ring treatment, and halo. Colour is reinforced, never the sole signal.
  4. **Clustering** — above 200 visible pins, `@googlemaps/markerclusterer` takes over with a hot-pin-styled cluster bubble (no numbered badge).

Both views share:
- A **counter row** in the header — `warm · active · stirring` counts pulled from the same payload.
- A **Horace summary line** — one Horace-voiced sentence composed server-side by Claude Haiku (cached 1h in Postgres).
- A **time scrubber** below the content — Today / This week / This month (24h / 7d / 30d). Drives a `?timeWindow=` URL param; both views honour it.
- A **slide-in signal panel** that opens on pin tap or suburb-label tap. Two render kinds (property + suburb) with the relevant Horace-voiced story.

## Signal model

### Intensity

`intensity` is **recency-weighted**, not a raw count. Every `property_view` event in the window contributes a weight that decays exponentially:

```
weight = 0.5 ^ (age_days / 7)
```

A 7-day half-life — an event today carries 2× a week-old event, 4× a fortnight-old event, 16× a month-old event. Sum the weights across the window, then normalise by `GREATEST(workspace_max_raw, 8.0)` so a single stray event in a quiet workspace doesn't warm everything to 1.0.

The floor of 8.0 means raw activity roughly equivalent to "8 fresh events" sets the workspace ceiling. Below that, intensities stay sub-tier no matter what.

Decay curve was signed off by Andy on 2026-05-19 (PR #102). Tuneable as a constant at the top of [`20260518000040_property_signal_rpcs.sql`](../../supabase/migrations/20260518000040_property_signal_rpcs.sql).

### Property tiers

| State | Intensity | What it means |
|---|---|---|
| `quiet`  | `< 0.25` | Nothing pulling for action right now. |
| `active` | `0.25 ≤ intensity < 0.65` | Light attention. Worth keeping warm. |
| `hot`    | `≥ 0.65` | Sustained attention — pattern building. |

### Suburb states

Suburbs share the same intensity model (aggregated over their properties), with one extra state:

| State | Rule | What it means |
|---|---|---|
| `quiet`    | `intensity < 0.25` | The suburb is asleep this window. |
| `warm`     | `0.25 ≤ intensity < 0.65` | Building warmth across the patch. |
| `hot`      | `≥ 0.65` | Concentrated signal — the suburb is loud. |
| `stirring` | `signal_delta_pct ≥ +25%` AND `state != 'hot'` | Activity climbing fast vs the previous window of equal length. |

`stirring` is a delta state. A suburb that's already hot doesn't go stirring — it's already loud, the delta is noise. Stirring is the early-warning lane.

## The `MapPayload` contract

The map view fetches a single endpoint:

```
GET /api/properties/map-payload?timeWindow=24h|7d|30d
```

Response shape (from [`apps/web/src/lib/map/rpc-types.ts`](../../apps/web/src/lib/map/rpc-types.ts)):

```ts
type MapPayload = {
  timeWindow: '24h' | '7d' | '30d'
  heat:       HeatCell[]          // grid of {lat, lng, intensity}
  suburbs:    SuburbSignal[]      // one row per workspace suburb
  properties: PropertySignal[]    // one row per workspace property
  summary:    string              // Horace-voiced sentence, server-composed
  counters:   { warm; active; stirring }
}
```

Every refetch hits this one endpoint — **no client-side recomputation**. The shape is intentionally **MCP-readiness** compliant (CLAUDE.md hard rule #3): every field a tool would need to render the map view is here, with no view-state coupling.

The endpoint is backed by three SECURITY DEFINER RPCs:
- `get_property_signals(workspace_id, agent_id, time_window)`
- `get_suburb_signals(workspace_id, agent_id, time_window)`
- `get_map_heat_cells(workspace_id, time_window)`

All three are `service_role`-only. The Next.js route is the authentication boundary; the RPCs trust the caller has already verified workspace ownership.

`PropertySignal` and `SuburbSignal` each carry an embedded `story` object — deterministic templates composed in [`lib/map/stories.ts`](../../apps/web/src/lib/map/stories.ts) and surfaced in the signal panel. Per-pin Haiku would be too slow and too costly; the map-level `summary` line stays Haiku because it runs once per refetch and is cached for an hour.

## Decisions locked in (HOR-215 epic)

1. **Map stack: Google Maps.** Extends [HOR-195](https://linear.app/gohorace/issue/HOR-195)'s `properties-map.tsx` rather than swapping to Mapbox. We review the substrate question after V1 ships, not before.
2. **Summary line via Haiku, per-pin stories deterministic.** `claude-haiku-4-5` for the once-per-refetch map summary; deterministic templates for the per-property and per-suburb stories the panel surfaces. Voice editable in `stories.ts` without a release.
3. **Cache lives in Postgres.** No Redis dependency. Summary cached 1h per `(workspace_id, agent_id, time_window, payload_hash)` in `map_summary_cache`. A tier flip busts the cache; intensity drift within a tier doesn't.
4. **URL is the source of truth for `timeWindow`.** `?timeWindow=24h|7d|30d` — reload preserves, view-toggle preserves, scrubber writes via `history.replaceState`.
5. **List filters don't apply to the map.** The map is the server-authoritative view of workspace signal. The chip filters (intensity, suburb, street, linked) are a list-only concern in V1.
6. **No CRM features in the panel.** "Signal story", not notes / deals / tasks. CTA on the property panel is "View property" → existing detail page where relationship work lives.

## Where the work landed

| Issue | What ships |
|---|---|
| [HOR-216](https://linear.app/gohorace/issue/HOR-216) (PR #102) | Three RPCs + `MapPayload` route + `?timeWindow=` plumbing on the server page |
| [HOR-217](https://linear.app/gohorace/issue/HOR-217) (PR #103) | Time scrubber + counter row + Horace-voiced summary via Haiku |
| [HOR-218](https://linear.app/gohorace/issue/HOR-218) (PR #104) | Heat layer + suburb labels + tiered pins + clustering |
| [HOR-219](https://linear.app/gohorace/issue/HOR-219) (PR #105) | Signal panel (slide-in, two render kinds, hash-routed) |
| [HOR-220](https://linear.app/gohorace/issue/HOR-220) (PR #106) | A11y parity, List view parity, empty state, this brief |

## Open follow-ups

- **[HOR-238](https://linear.app/gohorace/issue/HOR-238)** — `events.property_id` coverage was 0% across 9 events in the first prod audit. Tiny sample, but worth triaging once a workspace has real traffic. Without linkage the map renders the empty state instead of pins.
- **SlideOver primitive extraction** — the signal panel and the notifications slide-over now duplicate the hash-routed scrim/Esc pattern. A future PR should lift them into a shared `<SlideOver>`. Flagged in PR #105 description.
- **Mapbox review.** Booked for post-V1: do we get enough cartographic fidelity from styling Google Maps, or is it worth the vendor swap? Re-open when at least one non-Brisbane market is live.

## Out of scope (deliberate)

- Drawing custom farm areas
- Comparing two time windows side-by-side
- Exporting / sharing the map
- Saved views

All four would be follow-up epics. The brief's "single map view, one server contract" focus is what the V1 epic delivered.

## Reading order if you're new

1. Root [`CLAUDE.md`](../../CLAUDE.md) — hard rules and the doc-routing table.
2. This brief.
3. [`lib/map/rpc-types.ts`](../../apps/web/src/lib/map/rpc-types.ts) — the shape, with comments.
4. [`supabase/migrations/20260518000040_property_signal_rpcs.sql`](../../supabase/migrations/20260518000040_property_signal_rpcs.sql) — the intensity math.
5. Whichever PR description (HOR-216 → HOR-220) covers the part you're editing.

For voice / Horace tone questions: [`lib/copy/map-view.ts`](../../apps/web/src/lib/copy/map-view.ts) is the chokepoint. Edit there, not in component JSX.
