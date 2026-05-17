-- ============================================================
-- HOR-191  Core Markets — G-NAF sovereign schema
--
-- First of two PR-1 migrations. Creates the `gnaf` namespace and
-- its two read-only application-facing tables, populated by the
-- one-off ingest script at scripts/gnaf/ingest.ts (run quarterly
-- from an operator laptop; see docs/gnaf-refresh.md).
--
--   1. gnaf.localities         — suburb-level reference data,
--                                FK target for core_markets.
--   2. gnaf.address_principal  — denormalised per-address record,
--                                FK target for public.properties.
--
-- Schema separation is deliberate: G-NAF is CC BY 4.0 public data,
-- shared across all workspaces, refreshed in-place each quarter.
-- It belongs in its own namespace away from CRM-mirrored rows in
-- public.* (CLAUDE.md hard rule #1 — data sovereignty).
--
-- The ingest script materialises a join of PSMA's source tables
-- (ADDRESS_DETAIL × STREET_LOCALITY × LOCALITY × ADDRESS_DEFAULT_
-- GEOCODE) into gnaf.address_principal so the import path can do
-- a single locality-scoped indexed scan instead of joining at
-- read time. Raw PSMA tables are loaded into a transient
-- `gnaf_staging` schema by the script and dropped on completion.
--
-- Both 'P' (principal) and 'S' (sub-dwelling) records are kept —
-- sub-dwellings each get their own address_detail_pid, satisfying
-- the brief's "sub-dwellings are separate properties" rule.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS gnaf;

COMMENT ON SCHEMA gnaf IS
  'HOR-191: Geocoded National Address File (G-NAF), © PSMA Australia Limited, CC BY 4.0. Bulk-loaded quarterly by scripts/gnaf/ingest.ts. Read-only from application code; writes go through the ingest script with a service-role connection.';

-- pg_trgm powers the suburb-picker typeahead (HOR-192 ships the
-- search_localities RPC that uses it). IF NOT EXISTS keeps this
-- idempotent across environments that already have it enabled.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── gnaf.localities ────────────────────────────────────────────────
-- One row per (state, locality_pid). Drives the suburb picker and
-- is the FK target for core_markets.locality_pid (HOR-192).
--
-- Postcode is best-effort canonical — PSMA's data has multiple
-- postcodes for the same locality in some cases; we take the most
-- representative one in the join. The numeric centroid (lat/lng)
-- powers the map fallback when an agent has just added a market
-- and no individual addresses have rendered yet.
CREATE TABLE gnaf.localities (
  locality_pid     text PRIMARY KEY,
  locality_name    text NOT NULL,
  state_abbrev     text NOT NULL,
  postcode         text,
  latitude         numeric(10, 7),
  longitude        numeric(10, 7),
  gnaf_release     text NOT NULL,
  loaded_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gnaf_localities_name_state_idx
  ON gnaf.localities (lower(locality_name), state_abbrev);

CREATE INDEX gnaf_localities_name_trgm_idx
  ON gnaf.localities USING gin (locality_name gin_trgm_ops);

COMMENT ON TABLE gnaf.localities IS
  'HOR-191: G-NAF locality (suburb) reference. One row per locality_pid. Source of truth for the suburb picker typeahead and the FK target for core_markets.locality_pid.';

COMMENT ON COLUMN gnaf.localities.gnaf_release IS
  'Quarterly G-NAF release tag (e.g. "MAY26"). Stamped at ingest time so we can audit which release a row was last loaded from.';

-- ─── gnaf.address_principal ─────────────────────────────────────────
-- The flattened, denormalised per-address record. Populated by the
-- ingest script via INSERT...SELECT from the staged PSMA tables.
--
-- primary_secondary distinguishes:
--   • 'P' — principal address (the building / parcel itself)
--   • 'S' — sub-dwelling (unit / flat / suite within a building)
--
-- Each address_detail_pid is unique; a 40-unit apartment block has
-- 40 'S' rows plus 1 'P' row (the building principal). Brief: sub-
-- dwellings are separate properties at the data layer; the UI may
-- choose to group them later (HOR-199 follow-up).
--
-- Latitude/longitude come from G-NAF's default geocode (typically
-- the centroid of the parcel). Both are NULL-allowed because a
-- small tail of G-NAF rows lack a default geocode.
CREATE TABLE gnaf.address_principal (
  address_detail_pid   text PRIMARY KEY,
  locality_pid         text NOT NULL REFERENCES gnaf.localities(locality_pid),
  street_locality_pid  text,
  flat_type            text,
  flat_number_prefix   text,
  flat_number          text,
  flat_number_suffix   text,
  level_type           text,
  level_number         text,
  number_first_prefix  text,
  number_first         text,
  number_first_suffix  text,
  number_last          text,
  street_name          text,
  street_type_code     text,
  street_suffix_code   text,
  locality_name        text NOT NULL,
  state_abbrev         text NOT NULL,
  postcode             text,
  latitude             numeric(10, 7),
  longitude            numeric(10, 7),
  primary_secondary    text CHECK (primary_secondary IN ('P', 'S')),
  gnaf_release         text NOT NULL,
  loaded_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gnaf_address_principal_locality_idx
  ON gnaf.address_principal (locality_pid);

-- Composite supporting the batch import cursor (HOR-193) — pages
-- through address_detail_pids in deterministic order, locality-scoped.
CREATE INDEX gnaf_address_principal_locality_paging_idx
  ON gnaf.address_principal (locality_pid, address_detail_pid);

CREATE INDEX gnaf_address_principal_secondary_idx
  ON gnaf.address_principal (primary_secondary);

COMMENT ON TABLE gnaf.address_principal IS
  'HOR-191: G-NAF per-address canonical record. Materialised join of ADDRESS_DETAIL × STREET_LOCALITY × LOCALITY × ADDRESS_DEFAULT_GEOCODE produced by scripts/gnaf/ingest.ts. Both principal (P) and sub-dwelling (S) rows are kept — sub-dwellings are separate properties per the Core Markets brief.';

COMMENT ON COLUMN gnaf.address_principal.primary_secondary IS
  'P = principal address (building / parcel). S = sub-dwelling (unit / flat / suite). Both kinds have their own address_detail_pid and become independent properties rows at import time.';

-- ─── RLS ────────────────────────────────────────────────────────────
-- Defense in depth. The `gnaf` schema isn't in supabase/config.toml's
-- API-exposed list, so PostgREST won't surface these tables to
-- anon/authenticated keys today. RLS without policies silently
-- denies all anon/authenticated reads, so if a future config change
-- ever exposes the schema, we're still safe.
--
-- service_role bypasses RLS (Supabase's default role config). The
-- user-facing suburb-picker reads go through the SECURITY DEFINER
-- `search_localities` RPC (HOR-192), which runs as the function
-- owner and likewise bypasses RLS. No SELECT policies needed.
ALTER TABLE gnaf.localities         ENABLE ROW LEVEL SECURITY;
ALTER TABLE gnaf.address_principal  ENABLE ROW LEVEL SECURITY;

-- ─── Grants ─────────────────────────────────────────────────────────
-- Service-role (admin client) gets SELECT for completeness — it
-- bypasses RLS anyway, but the explicit grant matches the rest of
-- the schema. authenticated is granted SELECT as a no-op under RLS
-- (no policies = no rows visible), but kept for symmetry in case
-- we later add a read policy. No INSERT/UPDATE/DELETE grants —
-- writes happen via scripts/gnaf/ingest.mjs as the postgres role.
GRANT USAGE ON SCHEMA gnaf TO service_role, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA gnaf TO service_role, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA gnaf
  GRANT SELECT ON TABLES TO service_role, authenticated;
