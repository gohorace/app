# Agent site CMS survey — HOR-384 (P0)

Part of the [Site Content in Outreach epic (HOR-383)](https://linear.app/gohorace/issue/HOR-383).
Pins the platform-adapter priority for the P1 crawler ([HOR-385](https://linear.app/gohorace/issue/HOR-385)).

## Conclusion

**WordPress-first.** Build the WordPress adapter first, then schema.org `RealEstateListing`
JSON-LD extraction as the cross-platform fallback, then a generic parser. This matches both the
product prior ("most agents are on WordPress") and the only real data point we have today.

**Caveat — the survey is not yet statistically meaningful.** At the time of writing (2026-06-03)
production holds **24 agent accounts, mostly test/seed**, and only **one distinct real site host**
appears in tracking data (`maxproperty.au`, the demo site, shared across 3 workspaces). There is no
production agent base to survey yet. The adapter order rests on the product prior; **re-run this
survey once real agents onboard** (the forward-capture below makes the data accrue automatically).

## Findings (2026-06-03, prod)

| Site host | Workspaces | CMS (live `detectCms` markers) |
|---|---|---|
| `maxproperty.au` | 3 | **WordPress** — `wp-content/` ×28, `wp-includes/`, `<meta generator … WordPress>` |

- `agent_settings.website_url` was set on **1 of 24** agents before this work.
- 4 of 24 workspaces have any tracking events; 3 of those resolve to a real external site host
  (all `maxproperty.au`); the 4th is Andy's own test account (`website_url` = `andytwomey.com`,
  left untouched — its set value disagrees with its events host, which is exactly when not to
  overwrite).

## Methodology (reproducible)

The "real installed site" for an agent is the dominant non-infra host in `events.page_url`
(the snippet only fires on the agent's own pages — same ground truth `verify-snippet` uses).
Classification reuses the live `detectCms` markers in
`apps/web/src/app/api/onboarding/site-probe/detect.ts` (single source of truth).

Re-run the host derivation any time:

```sql
select workspace_id,
       lower(split_part(split_part(regexp_replace(page_url,'^https?://',''),'/',1),':',1)) as host,
       count(*) hits, max(occurred_at) last_seen
from events
where page_url is not null and page_url <> ''
group by 1,2
order by hits desc;
```

Then fetch each host (HoraceBot UA) and apply `detectCms`. At current scale this is a handful of
hosts; once the base grows, fold the classification into the P1 crawler — it already fetches and
parses every agent site, so the survey becomes a by-product of crawl runs rather than a separate
script. (No standalone harness was built for P0: with n=1 real host it would be premature, and
there is no `tsx`/`ts-node` in the repo to import `detect.ts` from a `.mjs` operator script without
duplicating its markers.)

## Capture going forward

`POST /api/onboarding/site-probe` now persists the confirmed, canonical (post-redirect) site URL to
`agent_settings.website_url` on a successful probe — the moment we know an agent's real, reachable
site. Best-effort: a lost write just means the agent re-enters it in Settings. This is the column
the P1 crawler reads to enqueue per-agent crawl jobs, and is already shared with the Settings
profile + MCP outreach tools.

## CMS kinds the detector recognises

`wordpress`, `wix`, `squarespace`, `domain_portal`, `rea_portal`, `shopify`, `webflow`, `custom`,
`unknown` (see `site-probe/validate.ts`). P1 adapter priority: **WordPress → schema.org JSON-LD →
generic parser**; portals (`domain_portal`/`rea_portal`) are out of v1 scope (agent doesn't own the
content surface).
