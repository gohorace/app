-- HOR-369 · Suburb boundary polygons for the city-zoom choropleth (epic HOR-368).
--
-- Gives the map real suburb polygon geometry to fill as a choropleth. Until
-- now the city read used Google's radial HeatmapLayer + suburb-label
-- OverlayViews at GNAF centroids; `patches.boundary_geojson` was reserved but
-- explicitly V2/unpopulated. This table is the geometry source.
--
-- Source: ABS ASGS 2021 "Suburbs and Localities" (SAL), GDA2020. Loaded by the
-- operator-run script `scripts/sal/ingest.mjs` (QLD-first, matching Core
-- Markets V1 G-NAF coverage). Geometry is Douglas–Peucker simplified at a
-- web-render tolerance to keep payloads light.
--
-- ─── locality_key design (the HOR-369 risk decision) ────────────────────────
--
-- `locality_key` IS the G-NAF `locality_pid` — i.e. the exact `id` that
-- `get_suburb_signals` emits when a suburb matches a GNAF locality
-- (`coalesce(loc.locality_pid, lower(sc.suburb))`, see
-- 20260518000040_property_signal_rpcs.sql). Keying on the PID makes the
-- serve-time join (`get_suburb_boundaries`) a plain equality against the same
-- id the client already holds — no name normalisation at request time.
--
-- The ingestion does the SAL→GNAF resolution ONCE, at load time: it matches
-- each SAL polygon to a GNAF locality by uppercased name + state and stores
-- the resolved PID here. Unmatched localities are logged by the script, not
-- silently dropped. `locality_name` / `state_abbrev` are carried for audit and
-- to make unmatched-row debugging legible.
--
-- Deliberately NO foreign key to gnaf.localities. The quarterly G-NAF ingest
-- (scripts/gnaf/ingest.mjs) rebuilds gnaf.localities via a rename-swap that
-- runs `DROP TABLE gnaf.localities_old CASCADE` — a FK here would be silently
-- dropped by that CASCADE and would have to be re-created inside the GNAF
-- runbook. We keep this table decoupled from that swap; stale keys (a locality
-- retired between SAL releases) simply stop matching at serve time, which is
-- the same graceful-degradation path as an unmatched suburb today.
--
-- ─── Apply procedure (NOT `db push`) ────────────────────────────────────────
--
-- Per the migration-tracking-drift note (CLAUDE.md): supabase_migrations
-- .schema_migrations stops at 2026-04-29 on prod, so `supabase db push` would
-- try to replay months of already-applied migrations. Apply this file by hand:
--   1. Run this DDL in the Studio SQL editor against prod.
--   2. INSERT INTO supabase_migrations.schema_migrations (version, name)
--        VALUES ('20260601000300', 'suburb_boundaries');
--   3. Then run scripts/sal/ingest.mjs to populate it.

create table if not exists public.suburb_boundaries (
  -- G-NAF locality_pid — the stable id get_suburb_signals returns. See header.
  locality_key      text primary key,
  -- Canonical uppercased locality name + state, carried for audit / debugging
  -- and so unmatched-or-renamed rows stay legible without a GNAF join.
  locality_name     text not null,
  state_abbrev      text not null,
  -- GeoJSON geometry object (Polygon | MultiPolygon), Douglas–Peucker
  -- simplified at a web-render tolerance. Coordinates are [lng, lat], WGS84.
  boundary_geojson  jsonb not null,
  -- Representative point for label placement / map fit. Sourced from the
  -- matched GNAF locality centroid (address-derived) at load time; falls back
  -- to the polygon centroid when the GNAF centroid is null.
  centroid_lat      numeric(10, 7),
  centroid_lng      numeric(10, 7),
  -- Provenance. e.g. source = 'ABS_ASGS_2021_SAL', source_version = 'GDA2020'.
  source            text not null,
  source_version    text not null,
  loaded_at         timestamptz not null default now()
);

-- locality_key is already the PK (hence indexed). state_abbrev gets its own
-- index for the "all boundaries in QLD" admin/debug queries and any future
-- state-scoped serve path.
create index if not exists suburb_boundaries_state_idx
  on public.suburb_boundaries (state_abbrev);

comment on table public.suburb_boundaries is
  'HOR-369: ABS ASGS 2021 SAL suburb polygons for the city-zoom choropleth. Keyed on G-NAF locality_pid (the id get_suburb_signals emits). Loaded by scripts/sal/ingest.mjs. No FK to gnaf.localities by design — see migration header.';

comment on column public.suburb_boundaries.locality_key is
  'G-NAF locality_pid; matches the id returned by get_suburb_signals. Resolved at ingest time from the SAL name+state.';
comment on column public.suburb_boundaries.boundary_geojson is
  'GeoJSON geometry (Polygon|MultiPolygon), Douglas–Peucker simplified at web-render tolerance. [lng,lat] WGS84.';

-- RLS: boundary geometry is public reference data (like gnaf.localities), but
-- the only reader is the service-role map-payload route via the definer RPC in
-- the companion migration. Enable RLS with no policy so direct anon/auth REST
-- access is denied; service_role bypasses RLS.
alter table public.suburb_boundaries enable row level security;
