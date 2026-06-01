# Suburb boundaries (SAL) — load runbook

How the suburb-boundary polygons behind the city-zoom choropleth get loaded into Horace. Owner: Andy. Cadence: **rare** — only when the ABS publishes a new ASGS edition (the boundaries are an ABS Census-cycle product, ~5-yearly) or when we extend coverage to a new state.

This doc lives in the repo, like [`docs/gnaf-refresh.md`](/docs/gnaf-refresh.md), because the operation is irregular, partially manual, and touches prod. When someone needs to reload or extend coverage, this is the file that says exactly how.

Ticket: [HOR-369](https://linear.app/gohorace/issue/HOR-369). Consumer: the city read on the Market / Properties map ([HOR-368](https://linear.app/gohorace/issue/HOR-368), FE in [HOR-370](https://linear.app/gohorace/issue/HOR-370)).

---

## What it does

ABS ASGS 2021 **Suburbs and Localities (SAL)** is the canonical Australian suburb-polygon dataset, published by the ABS under CC BY 4.0. Horace's ingest ([`scripts/sal/ingest.mjs`](/scripts/sal/ingest.mjs)):

1. Reads the SAL geometry (GeoJSON FeatureCollection).
2. Filters to the in-scope states (**QLD only** in V1 — matches Core Markets G-NAF coverage).
3. Simplifies each polygon with Douglas–Peucker at a web-render tolerance so the choropleth payload stays light.
4. Matches each SAL polygon to the **G-NAF `locality_pid`** that `get_suburb_signals` emits, by uppercased locality name + state.
5. Upserts into `public.suburb_boundaries`, keyed on that `locality_pid`.

`get_suburb_boundaries` then serves the geometry through `/api/properties/map-payload` as a parallel `boundaries[]` array, keyed by the same suburb `id` as `suburbs[]`. Suburbs with no matched boundary simply fall back to radial heat.

Unlike the G-NAF refresh there is **no atomic table swap** — the dataset is small (QLD is ~3.5k localities) and the load is an idempotent `INSERT … ON CONFLICT (locality_key) DO UPDATE`. Re-running is safe and just refreshes the rows.

---

## Why we pin a source URL (the "more robust than my laptop" bit)

The first load was sourced from a file on an operator's machine. That's not reproducible — the next person can't recreate the exact dataset. The robust pattern (same as G-NAF's `GNAF_RELEASE_URL`) is to pin **one canonical, documented source URL** and pass it as `SAL_GEOJSON_URL`. The script downloads it; nobody depends on a particular disk.

Capture provenance every load via the `source` / `source_version` columns (defaults: `ABS_ASGS_2021_SAL` / `GDA2020`).

**V1.5:** mirror the chosen SAL GeoJSON into our own S3 bucket (CDN-backed) and pin `SAL_GEOJSON_URL` at that mirror, so the load is independent of ABS endpoint changes — mirrors the G-NAF V2 plan.

---

## Access needed

- Node 20+ and pnpm 9 (matches `package.json` `packageManager`); repo cloned + `pnpm install` run at root.
- The **service-role DB connection string** for the target Supabase project (1Password → "Supabase prod — service-role DB", or the staging entry). Use the **session pooler** (`pooler.supabase.com:5432`) or **direct** connection.
- Outbound access to the SAL source (see below). Note: the ABS / data.gov.au hosts are **not reachable from the Claude Code web sandbox** (they 403 there) — run from a laptop, or mirror to a reachable host first.

---

## Source options

ABS ships ASGS natively as **Shapefile / GeoPackage**, not GeoJSON. Pick one path to a GeoJSON `SAL_GEOJSON_URL` (or a local `SAL_GEOJSON_PATH`):

1. **Digital Atlas of Australia WFS (preferred — serves GeoJSON directly, scriptable).**
   The ABS ASGS 2021 SAL layer is published on the Digital Atlas. Build a WFS `GetFeature` request with `outputFormat=application/json` and, optionally, a `CQL_FILTER`/`STATE`-code filter for QLD (state code `3`) to shrink the download. Confirm the exact `typeName` (layer id) from the Digital Atlas service catalogue before pinning it here — **TODO: paste the confirmed WFS URL once verified.**

2. **data.gov.au ASGS 2021 SAL dataset → convert.**
   Download the SAL GeoPackage/Shapefile from the [ABS ASGS Edition 3 (2021) dataset on data.gov.au](https://data.gov.au/), then convert to GeoJSON once:
   ```bash
   ogr2ogr -f GeoJSON SAL_2021_AUST_GDA2020.geojson SAL_2021_AUST_GDA2020.gpkg
   ```
   Pass the result as `SAL_GEOJSON_PATH`.

Either way, the script reads `SAL_NAME21` / `STE_NAME21` (or `STE_CODE21`) tolerantly, strips any ABS state parenthetical (e.g. `New Farm (Qld)` → `NEW FARM`), and joins on uppercased name + state.

---

## Pre-flight

- [ ] Migrations `20260601000300_suburb_boundaries` and `20260601000310_get_suburb_boundaries_rpc` are applied to the target DB. **(Already applied to prod 2026-06-01 and recorded in `schema_migrations`.)**
- [ ] `gnaf.localities` is populated for the in-scope state(s) — the match joins against it. (QLD: ~3,545 localities as of the MAY26 G-NAF.)
- [ ] You have a `SAL_GEOJSON_URL` or `SAL_GEOJSON_PATH` per the source options above.

---

## Steps

### 1. Set env

```bash
export SUPABASE_DB_URL='postgresql://postgres.PROJECT_REF:PASSWORD@aws-X-region.pooler.supabase.com:5432/postgres'

# one of:
export SAL_GEOJSON_PATH='/data/SAL_2021_AUST_GDA2020.geojson'
# export SAL_GEOJSON_URL='https://.../sal-2021-qld.geojson'

# optional tuning (defaults shown):
# export SAL_STATES='QLD'
# export SIMPLIFY_TOLERANCE='0.0005'     # degrees, ≈ 55 m
# export SAL_SOURCE_VERSION='GDA2020'
```

### 2. Dry-run

```bash
cd ~/code/horace
node scripts/sal/ingest.mjs --dry-run
```

Expect, at the tail:

```
[hh:mm:ss] in-scope features (QLD): ~3,500
[hh:mm:ss] matched to GNAF locality_pid: ~3,4xx
[hh:mm:ss] would write to suburb_boundaries: ~3,4xx
[hh:mm:ss] vertices: N → M (−xx% after simplify)
[hh:mm:ss] spot-checks (design screen 02):
[hh:mm:ss]   NEW FARM: matched → loc...
[hh:mm:ss]   PADDINGTON: matched → loc...
[hh:mm:ss]   TENERIFFE: matched → loc...
[hh:mm:ss]   WEST END: matched → loc...
[hh:mm:ss] unmatched SAL localities (K) — review before trusting this load:
...
[hh:mm:ss] dry-run complete — no rows written.
```

**Review the unmatched list.** A handful of island/bay/industrial localities with no G-NAF presence is expected; a *large* unmatched count means the name/state join drifted (e.g. ABS renamed a tranche, or the wrong state filter) — investigate before loading. The four design spot-checks must all match, or the script exits non-zero.

### 3. Load

```bash
node scripts/sal/ingest.mjs
```

Idempotent upsert; re-run any time to refresh.

### 4. Post-load verification

In the target project's SQL editor:

```sql
select count(*) from public.suburb_boundaries;                 -- ~3,4xx for QLD
select count(*) from public.suburb_boundaries
  where centroid_lat is null;                                  -- should be ~0

-- The four design suburbs carry geometry:
select locality_key, locality_name,
       boundary_geojson->>'type' as geom_type,
       centroid_lat, centroid_lng
from public.suburb_boundaries
where locality_name in ('NEW FARM','PADDINGTON','TENERIFFE','WEST END');

-- End-to-end through the RPC for a known New Farm test workspace:
select * from public.get_suburb_boundaries(
  '<workspace_uuid>'::uuid, '<agent_uuid>'::uuid, '7d');
```

Then load `/market` (or Properties → map) as a New Farm test agent: at city zoom the signalled suburbs should render as filled polygons rather than radial heat.

---

## Failure modes & recovery

- **Spot-check fails (a design suburb didn't match).** The script exits non-zero before writing anything in `--dry-run` and aborts the matched set. Usually a name/state mismatch — check the suburb exists in `gnaf.localities` for QLD and that `STE_*` parsing resolved to `QLD`.
- **Geometry collapsed at tolerance.** Logged per-locality. If a real suburb collapses, lower `SIMPLIFY_TOLERANCE` and re-run.
- **Large unmatched count.** Don't trust the load. Confirm the SAL source is the QLD slice you expect and that `gnaf.localities` is current.
- **Bad load.** The table is a plain upsert — re-run with a corrected source to overwrite, or `truncate public.suburb_boundaries;` and reload. There's no FK pointing at it, so truncate is safe.

---

## Applying the migrations without `db push`

Per the migration-tracking note, apply new migrations explicitly rather than via `supabase db push`. Either run the two files in the Studio SQL editor and then:

```sql
insert into supabase_migrations.schema_migrations (version, name) values
  ('20260601000300', 'suburb_boundaries'),
  ('20260601000310', 'get_suburb_boundaries_rpc');
```

…or apply them through the Supabase MCP (records the same rows). Both were already applied to prod on 2026-06-01.

> **Note on the drift:** as of 2026-06-01, prod's `supabase_migrations.schema_migrations` is current through `20260601000200` — it is *no longer* stuck at 2026-04-29 as the older `CLAUDE.md` memory note states. The note is stale; the table has been reconciled.

---

## Licensing

ASGS Suburbs and Localities is published by the Australian Bureau of Statistics under [Creative Commons Attribution 4.0 (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/). Attribute the ABS on the Trust page alongside the G-NAF attribution ([HOR-197](https://linear.app/gohorace/issue/HOR-197)) when the choropleth ships.
