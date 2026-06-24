-- ============================================================
-- HOR-410  Granular location import — schema (1 of 4)
--
-- Extends the Core Markets import path so an agent can import at
-- THREE granularities, not just suburb:
--
--   • suburb   — every G-NAF address in a locality (existing behaviour)
--   • street   — every address on one street (gnaf street_locality)
--   • building — every address in one building / complex, modelled
--                structurally as a (street_locality_pid, number_first)
--                group: the 'P' principal plus its 'S' sub-dwellings.
--
-- Design constraints honoured:
--   • No G-NAF re-ingest. Street + building both resolve off columns
--     already present on gnaf.address_principal (street_locality_pid,
--     number_first, primary_secondary). The "building name" path is
--     deliberately NOT used — G-NAF's building_name isn't materialised.
--   • Suburb stays the default — `granularity` defaults to 'suburb',
--     so every existing row and every existing writer keeps working
--     with zero changes. No backfill of historical imports.
--   • Each imported property records WHICH granularity and WHICH
--     specific source location it came from (import_granularity +
--     import_source_pid), so the provenance is auditable later.
--
-- This migration only touches schema. The search RPCs (3) and the
-- granularity-aware batch worker (4) ship in sibling migrations.
-- ============================================================

BEGIN;

-- ─── core_markets: granularity + scope ──────────────────────────────
-- A core_markets row is still "a place an agent works". We widen the
-- notion of "place" from suburb-only to {suburb, street, building}.
--
--   • granularity          — which kind of place this row selects.
--   • street_locality_pid   — set for street + building rows; the G-NAF
--                             street id (already locality-scoped).
--   • building_number_first — set for building rows; the street number
--                             that identifies the building/complex.
--   • street_name           — denormalised for the Settings/Properties
--                             UIs (mirrors the existing locality_name).
ALTER TABLE core_markets
  ADD COLUMN IF NOT EXISTS granularity text NOT NULL DEFAULT 'suburb'
    CHECK (granularity IN ('suburb', 'street', 'building')),
  ADD COLUMN IF NOT EXISTS street_locality_pid   text,
  ADD COLUMN IF NOT EXISTS building_number_first text,
  ADD COLUMN IF NOT EXISTS street_name           text;

-- Shape guard: street/building rows must carry the scope that defines
-- them; suburb rows must not. Keeps malformed selections out of the
-- import path before the worker ever sees them.
ALTER TABLE core_markets
  DROP CONSTRAINT IF EXISTS core_markets_granularity_scope_chk;
ALTER TABLE core_markets
  ADD CONSTRAINT core_markets_granularity_scope_chk CHECK (
    (granularity = 'suburb'
      AND street_locality_pid IS NULL AND building_number_first IS NULL)
    OR (granularity = 'street'
      AND street_locality_pid IS NOT NULL AND building_number_first IS NULL)
    OR (granularity = 'building'
      AND street_locality_pid IS NOT NULL AND building_number_first IS NOT NULL)
  );

-- The old uniqueness was (agent_id, locality_pid) — that would block an
-- agent from adding two streets in the same suburb (same locality_pid).
-- Widen it to the full scope tuple so each distinct place is independent,
-- while still preventing duplicate active selections of the SAME place.
-- COALESCE the nullable scope columns to '' so suburb rows (both NULL)
-- collapse to one key per (agent, locality).
DROP INDEX IF EXISTS core_markets_agent_locality_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS core_markets_agent_scope_uidx
  ON core_markets (
    agent_id,
    granularity,
    locality_pid,
    coalesce(street_locality_pid, ''),
    coalesce(building_number_first, '')
  )
  WHERE archived_at IS NULL;

COMMENT ON COLUMN core_markets.granularity IS
  'HOR-410: import scope — suburb (whole locality), street (one gnaf street_locality), or building (one (street_locality_pid, number_first) complex). Defaults to suburb so pre-HOR-410 rows and writers are unaffected.';
COMMENT ON COLUMN core_markets.street_locality_pid IS
  'HOR-410: G-NAF street id. Set for granularity in (street, building); null for suburb rows.';
COMMENT ON COLUMN core_markets.building_number_first IS
  'HOR-410: street number identifying a building/complex within a street. Set for granularity=building only; the import pulls the P principal + all S sub-dwellings sharing this (street_locality_pid, number_first).';

-- ─── core_market_imports: mirror the scope ──────────────────────────
-- The worker reads scope off the import row (not the parent market), so
-- these columns must travel with the job. POST /api/core-markets stamps
-- them at enqueue time alongside locality_pid.
ALTER TABLE core_market_imports
  ADD COLUMN IF NOT EXISTS granularity text NOT NULL DEFAULT 'suburb'
    CHECK (granularity IN ('suburb', 'street', 'building')),
  ADD COLUMN IF NOT EXISTS street_locality_pid   text,
  ADD COLUMN IF NOT EXISTS building_number_first text;

COMMENT ON COLUMN core_market_imports.granularity IS
  'HOR-410: scope of this import job — suburb | street | building. The batch worker (import_core_market_batch) branches its source filter on this.';

-- ─── properties: provenance of an imported row ──────────────────────
-- Records the granularity + the specific source location each imported
-- property came from. Nullable: only G-NAF-import rows carry it, so
-- manual / CSV / listing-scrape rows stay null and existing data needs
-- no backfill.
--
-- import_source_pid is the scope key that pulled the row:
--   • suburb   → locality_pid
--   • street   → street_locality_pid
--   • building → street_locality_pid || ':' || number_first
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS import_granularity text
    CHECK (import_granularity IN ('suburb', 'street', 'building')),
  ADD COLUMN IF NOT EXISTS import_source_pid text;

COMMENT ON COLUMN properties.import_granularity IS
  'HOR-410: granularity the row was imported at (suburb | street | building). Null for properties created manually, via CSV, or by listing scrapes.';
COMMENT ON COLUMN properties.import_source_pid IS
  'HOR-410: the specific source scope key the import used — locality_pid (suburb), street_locality_pid (street), or "street_locality_pid:number_first" (building). Audit trail for "where did this property come from".';

-- ─── gnaf_import_suppressions: delete tombstones ────────────────────
-- The import upsert dedups on the partial unique index
-- (workspace_id, address_hash) WHERE deleted_at IS NULL. A soft-deleted
-- G-NAF property therefore does NOT block re-insertion — it would
-- silently reappear on the next import/refresh of its scope.
--
-- This table is the durable tombstone: deleting a G-NAF-sourced property
-- records its address_detail_pid here, and the batch worker skips any
-- suppressed pid for that workspace. Per-workspace because deletion is a
-- sovereign, workspace-local choice (CLAUDE.md hard rule #1) — one
-- agent's deletion must not affect another workspace's import.
CREATE TABLE IF NOT EXISTS gnaf_import_suppressions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  gnaf_address_detail_pid text NOT NULL,
  -- The property row that was deleted, for audit. Nullable: the property
  -- may be hard-purged later while the tombstone lives on.
  property_id            uuid REFERENCES properties(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- One tombstone per (workspace, gnaf address). Re-deleting is a no-op
-- upsert; the import worker's NOT EXISTS check only needs presence.
CREATE UNIQUE INDEX IF NOT EXISTS gnaf_import_suppressions_ws_pid_uidx
  ON gnaf_import_suppressions (workspace_id, gnaf_address_detail_pid);

ALTER TABLE gnaf_import_suppressions ENABLE ROW LEVEL SECURITY;

-- Workspace members may read their own tombstones (e.g. a future
-- "restore deleted" surface). Writes go through the admin client in
-- DELETE /api/properties — no INSERT/UPDATE/DELETE policy on purpose.
DROP POLICY IF EXISTS "gnaf_import_suppressions_select" ON gnaf_import_suppressions;
CREATE POLICY "gnaf_import_suppressions_select" ON gnaf_import_suppressions
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

COMMENT ON TABLE gnaf_import_suppressions IS
  'HOR-410: per-workspace tombstones for deleted G-NAF-sourced properties. The Core Markets batch worker skips any suppressed gnaf_address_detail_pid so a deleted imported property does not reappear on the next import/refresh.';

-- ─── gnaf.address_principal: paging indexes for the new scopes ──────
-- The suburb path pages by (locality_pid, address_detail_pid). Street
-- and building need their own composite covering indexes so the batch
-- cursor scan stays an indexed range, not a filter-on-locality scan.
CREATE INDEX IF NOT EXISTS gnaf_address_principal_street_paging_idx
  ON gnaf.address_principal (street_locality_pid, address_detail_pid);

CREATE INDEX IF NOT EXISTS gnaf_address_principal_building_paging_idx
  ON gnaf.address_principal (street_locality_pid, number_first, address_detail_pid);

COMMIT;
