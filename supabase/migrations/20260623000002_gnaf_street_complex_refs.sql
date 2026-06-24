-- ============================================================
-- HOR-410  Granular location import — G-NAF derived references (2 of 4)
--
-- Street and building/complex search need a small, indexable reference
-- per street and per complex — the same role gnaf.localities plays for
-- the suburb picker. Rather than re-ingest G-NAF (its building_name
-- field is deliberately out of scope), we DERIVE both tables from the
-- already-loaded gnaf.address_principal:
--
--   • gnaf.street_localities — one row per street_locality_pid, with a
--     trigram index on street_name for the typeahead.
--   • gnaf.complexes         — one row per (street_locality_pid,
--     number_first) that has G-NAF sub-dwellings ('S' rows). This is
--     the structural definition of a "building / complex": a principal
--     address ('P') plus the units within it. unit_count + principal_pid
--     let the picker show "10 Smith St — 40 units" for disambiguation.
--
-- gnaf.refresh_address_derivations() rebuilds both from
-- gnaf.address_principal. It is called once here, and should be called
-- by scripts/gnaf/ingest.mjs after each quarterly rename-swap so the
-- derived tables never drift from the address table they summarise.
-- ============================================================

BEGIN;

-- ─── gnaf.street_localities ─────────────────────────────────────────
-- FK target for core_markets.street_locality_pid (granularity=street).
-- One row per G-NAF street within a locality. address_count drives the
-- "≈ N properties" hint the picker shows before an agent confirms.
CREATE TABLE IF NOT EXISTS gnaf.street_localities (
  street_locality_pid text PRIMARY KEY,
  street_name         text,
  street_type_code    text,
  street_suffix_code  text,
  locality_pid        text NOT NULL,
  locality_name       text NOT NULL,
  state_abbrev        text NOT NULL,
  postcode            text,
  address_count       integer NOT NULL DEFAULT 0,
  refreshed_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gnaf_street_localities_name_trgm_idx
  ON gnaf.street_localities USING gin (street_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS gnaf_street_localities_locality_idx
  ON gnaf.street_localities (locality_pid);

COMMENT ON TABLE gnaf.street_localities IS
  'HOR-410: derived one-row-per-street reference for the street import picker. Rebuilt from gnaf.address_principal by gnaf.refresh_address_derivations(). street_locality_pid is G-NAF''s street id, intrinsically scoped to one locality.';

-- ─── gnaf.complexes ─────────────────────────────────────────────────
-- FK-ish target (text key) for the building granularity. A "complex" is
-- a (street_locality_pid, number_first) group that contains at least one
-- 'S' sub-dwelling — i.e. an addressable building with units. The import
-- pulls the whole group (the 'P' principal + every 'S' unit).
CREATE TABLE IF NOT EXISTS gnaf.complexes (
  -- street_locality_pid || ':' || number_first
  complex_key         text PRIMARY KEY,
  street_locality_pid text NOT NULL,
  number_first        text NOT NULL,
  street_name         text,
  street_type_code    text,
  locality_pid        text NOT NULL,
  locality_name       text NOT NULL,
  state_abbrev        text NOT NULL,
  postcode            text,
  -- Count of 'S' sub-dwellings (units). >0 by construction.
  unit_count          integer NOT NULL DEFAULT 0,
  -- Total addresses in the group (P + S). >= unit_count.
  address_count       integer NOT NULL DEFAULT 0,
  -- The principal address pid if G-NAF carries one ('P'); null otherwise.
  principal_pid       text,
  refreshed_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gnaf_complexes_name_trgm_idx
  ON gnaf.complexes USING gin (street_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS gnaf_complexes_street_idx
  ON gnaf.complexes (street_locality_pid, number_first);

COMMENT ON TABLE gnaf.complexes IS
  'HOR-410: derived one-row-per-building/complex reference. A complex = a (street_locality_pid, number_first) group that has G-NAF sub-dwellings (S rows). Rebuilt from gnaf.address_principal by gnaf.refresh_address_derivations(). No building_name — the structural P/S hierarchy stands in for a named entity (no re-ingest required).';

-- ─── RLS + grants (mirror gnaf.localities) ──────────────────────────
-- Defense in depth: RLS on with no policies denies anon/authenticated
-- reads. The search RPCs are SECURITY DEFINER and bypass RLS.
ALTER TABLE gnaf.street_localities ENABLE ROW LEVEL SECURITY;
ALTER TABLE gnaf.complexes         ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON gnaf.street_localities, gnaf.complexes TO service_role, authenticated;

-- core_markets / core_market_imports reference these by text id; the FK
-- would bind to the table OID and break on the quarterly rename-swap of
-- the derived tables, so (matching the address_principal pattern) we do
-- NOT add a hard FK. Validation happens in POST /api/core-markets.

-- ─── Refresh function ───────────────────────────────────────────────
-- Rebuilds both derived tables from gnaf.address_principal in one txn.
-- DELETE + INSERT (not TRUNCATE) so it composes inside the caller's
-- transaction and respects any concurrent readers via MVCC.
CREATE OR REPLACE FUNCTION gnaf.refresh_address_derivations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gnaf, public
AS $$
BEGIN
  -- Streets: one row per street_locality_pid. The name/type/locality
  -- fields are consistent within a street_locality_pid, so max() just
  -- picks the (single) value; address_count is the import-size hint.
  DELETE FROM gnaf.street_localities;
  INSERT INTO gnaf.street_localities (
    street_locality_pid, street_name, street_type_code, street_suffix_code,
    locality_pid, locality_name, state_abbrev, postcode, address_count, refreshed_at
  )
  SELECT
    ap.street_locality_pid,
    max(ap.street_name),
    max(ap.street_type_code),
    max(ap.street_suffix_code),
    min(ap.locality_pid),
    max(ap.locality_name),
    max(ap.state_abbrev),
    max(ap.postcode),
    count(*)::int,
    now()
  FROM gnaf.address_principal ap
  WHERE ap.street_locality_pid IS NOT NULL
  GROUP BY ap.street_locality_pid;

  -- Complexes: (street_locality_pid, number_first) groups that contain
  -- at least one sub-dwelling. principal_pid is the 'P' row when present.
  DELETE FROM gnaf.complexes;
  INSERT INTO gnaf.complexes (
    complex_key, street_locality_pid, number_first,
    street_name, street_type_code,
    locality_pid, locality_name, state_abbrev, postcode,
    unit_count, address_count, principal_pid, refreshed_at
  )
  SELECT
    ap.street_locality_pid || ':' || ap.number_first AS complex_key,
    ap.street_locality_pid,
    ap.number_first,
    max(ap.street_name),
    max(ap.street_type_code),
    min(ap.locality_pid),
    max(ap.locality_name),
    max(ap.state_abbrev),
    max(ap.postcode),
    count(*) FILTER (WHERE ap.primary_secondary = 'S')::int AS unit_count,
    count(*)::int AS address_count,
    max(ap.address_detail_pid) FILTER (WHERE ap.primary_secondary = 'P') AS principal_pid,
    now()
  FROM gnaf.address_principal ap
  WHERE ap.street_locality_pid IS NOT NULL
    AND ap.number_first IS NOT NULL
    AND ap.number_first <> ''
  GROUP BY ap.street_locality_pid, ap.number_first
  HAVING count(*) FILTER (WHERE ap.primary_secondary = 'S') > 0;
END;
$$;

REVOKE ALL ON FUNCTION gnaf.refresh_address_derivations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gnaf.refresh_address_derivations() TO service_role;

COMMENT ON FUNCTION gnaf.refresh_address_derivations() IS
  'HOR-410: rebuilds gnaf.street_localities and gnaf.complexes from gnaf.address_principal. Call once after each quarterly G-NAF ingest rename-swap (scripts/gnaf/ingest.mjs) to keep the derived references in sync.';

-- Initial populate. No-op on environments where G-NAF hasn't been
-- ingested yet (the source table is simply empty there).
SELECT gnaf.refresh_address_derivations();

COMMIT;
