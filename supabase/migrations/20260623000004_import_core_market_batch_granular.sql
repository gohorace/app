-- ============================================================
-- HOR-410  Granular location import — batch worker (4 of 4)
--
-- Replaces import_core_market_batch (20260517000010) with a
-- granularity-aware version. The mechanism is unchanged — page
-- gnaf.address_principal into properties, upsert on address_hash,
-- auto-match contacts, advance the cursor — but the SOURCE FILTER now
-- branches on the import's granularity:
--
--   • suburb   → ap.locality_pid = locality_pid              (existing)
--   • street   → ap.street_locality_pid = street_locality_pid
--   • building → ap.street_locality_pid = street_locality_pid
--                AND ap.number_first   = building_number_first
--
-- Two further additions:
--   1. Suppression skip — rows whose address_detail_pid is tombstoned
--      in gnaf_import_suppressions for this workspace are excluded, so
--      a deleted G-NAF property does not reappear (HOR-410 delete flow).
--   2. Provenance stamp — each inserted property records
--      import_granularity + import_source_pid for audit.
--
-- Everything else (dedupe-within-batch, ON CONFLICT attach, match pass,
-- cursor/counter update, done semantics) is carried over verbatim.
-- ============================================================

CREATE OR REPLACE FUNCTION public.import_core_market_batch(
  p_import_id  uuid,
  p_batch_size int DEFAULT 2000
)
RETURNS TABLE (
  done          boolean,
  batch_cursor  text,
  imported      int,
  matched       int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_workspace_id  uuid;
  v_locality_pid  text;
  v_granularity   text;
  v_street_pid    text;
  v_building_num  text;
  v_source_pid    text;
  v_cursor        text;
  v_new_hashes    text[];
  v_imported      int;
  v_matched       int;
  v_new_cursor    text;
BEGIN
  -- ── 1. Fetch import job context ────────────────────────────────────
  SELECT cmi.workspace_id, cmi.locality_pid, cmi.granularity,
         cmi.street_locality_pid, cmi.building_number_first, cmi.batch_cursor
    INTO v_workspace_id, v_locality_pid, v_granularity,
         v_street_pid, v_building_num, v_cursor
    FROM core_market_imports cmi
   WHERE cmi.id = p_import_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'import_core_market_batch: import % not found', p_import_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- The scope key stamped onto every property this job imports.
  v_source_pid := CASE v_granularity
    WHEN 'suburb'   THEN v_locality_pid
    WHEN 'street'   THEN v_street_pid
    WHEN 'building' THEN v_street_pid || ':' || v_building_num
  END;

  -- ── 2. Bulk INSERT from gnaf.address_principal into properties ────
  --
  -- `src` is the only granularity-dependent piece: the WHERE filter
  -- selects the suburb / street / building slice. Cursor paging stays
  -- keyed on address_detail_pid (the street/building paging indexes
  -- from migration 1 keep this an indexed range scan). Suppressed pids
  -- (deleted G-NAF properties) are excluded here so they never re-enter.
  WITH src AS (
    SELECT ap.*
      FROM gnaf.address_principal ap
     WHERE (
             (v_granularity = 'suburb'   AND ap.locality_pid        = v_locality_pid)
          OR (v_granularity = 'street'   AND ap.street_locality_pid = v_street_pid)
          OR (v_granularity = 'building' AND ap.street_locality_pid = v_street_pid
                                         AND ap.number_first        = v_building_num)
           )
       AND (v_cursor IS NULL OR ap.address_detail_pid > v_cursor)
       AND NOT EXISTS (
             SELECT 1 FROM gnaf_import_suppressions s
              WHERE s.workspace_id            = v_workspace_id
                AND s.gnaf_address_detail_pid = ap.address_detail_pid
           )
     ORDER BY ap.address_detail_pid
     LIMIT p_batch_size
  ),
  built AS (
    SELECT
      v_workspace_id AS workspace_id,
      src.address_detail_pid AS gnaf_address_detail_pid,
      CASE WHEN src.flat_number IS NOT NULL AND src.flat_number <> ''
           THEN concat(src.flat_number, '/', src.number_first)
           ELSE src.number_first END AS street_number,
      trim(concat_ws(' ',
        initcap(lower(src.street_name)),
        initcap(lower(src.street_type_code))
      )) AS street_name,
      initcap(lower(src.locality_name)) AS suburb,
      src.state_abbrev AS state,
      src.postcode,
      src.latitude,
      src.longitude,
      src.address_detail_pid AS detail_pid_for_cursor
    FROM src
  ),
  with_hash AS (
    SELECT b.*,
           compute_address_hash(
             b.street_number, b.street_name, b.suburb, b.state, b.postcode, NULL
           ) AS computed_hash
    FROM built b
    WHERE compute_address_hash(
            b.street_number, b.street_name, b.suburb, b.state, b.postcode, NULL
          ) IS NOT NULL
  ),
  -- Dedupe aliased pids that collapse to the same address_hash within a
  -- batch (see 20260517000010 for the prod incident this guards).
  deduped AS (
    SELECT DISTINCT ON (computed_hash) *
    FROM with_hash
    ORDER BY computed_hash, detail_pid_for_cursor
  ),
  inserted AS (
    INSERT INTO properties (
      workspace_id, gnaf_address_detail_pid,
      street_number, street_name, suburb, state, postcode,
      latitude, longitude,
      address_hash, status, first_seen_at, last_activity_at,
      import_granularity, import_source_pid
    )
    SELECT
      d.workspace_id,
      d.gnaf_address_detail_pid,
      d.street_number, d.street_name, d.suburb, d.state, d.postcode,
      d.latitude, d.longitude,
      d.computed_hash,
      'residence_only',
      now(), now(),
      v_granularity, v_source_pid
    FROM deduped d
    ON CONFLICT (workspace_id, address_hash) WHERE deleted_at IS NULL DO UPDATE
      SET gnaf_address_detail_pid = COALESCE(properties.gnaf_address_detail_pid, EXCLUDED.gnaf_address_detail_pid),
          latitude         = COALESCE(properties.latitude,  EXCLUDED.latitude),
          longitude        = COALESCE(properties.longitude, EXCLUDED.longitude),
          -- Stamp provenance only if the row didn't already have it
          -- (don't overwrite an existing/finer attribution).
          import_granularity = COALESCE(properties.import_granularity, EXCLUDED.import_granularity),
          import_source_pid  = COALESCE(properties.import_source_pid,  EXCLUDED.import_source_pid),
          last_activity_at = now()
    RETURNING address_hash, id
  ),
  agg AS (
    SELECT
      array_agg(i.address_hash) AS hashes,
      (SELECT count(*)::int FROM src)             AS src_count,
      (SELECT max(b.detail_pid_for_cursor) FROM built b) AS new_cursor
    FROM inserted i
  )
  SELECT
    COALESCE(hashes, ARRAY[]::text[]),
    COALESCE(src_count, 0),
    new_cursor
  INTO v_new_hashes, v_imported, v_new_cursor
  FROM agg;

  -- ── 3. Match pass ──────────────────────────────────────────────────
  IF array_length(v_new_hashes, 1) > 0 THEN
    WITH match_set AS (
      UPDATE contacts c
         SET residence_property_id = p.id
        FROM properties p
       WHERE p.address_hash = ANY(v_new_hashes)
         AND p.workspace_id = v_workspace_id
         AND p.deleted_at IS NULL
         AND c.workspace_id = v_workspace_id
         AND c.deleted_at IS NULL
         AND c.residence_property_id IS NULL
         AND compute_address_hash(
               NULL, NULL, c.suburb, NULL, NULL, c.property_address
             ) = p.address_hash
      RETURNING c.id
    )
    SELECT count(*)::int INTO v_matched FROM match_set;
  ELSE
    v_matched := 0;
  END IF;

  v_matched := COALESCE(v_matched, 0);

  -- ── 4. Update import row state ────────────────────────────────────
  UPDATE core_market_imports cmi
     SET batch_cursor  = COALESCE(v_new_cursor, cmi.batch_cursor),
         rows_imported = cmi.rows_imported + v_imported,
         rows_matched  = cmi.rows_matched + v_matched,
         heartbeat_at  = now(),
         status        = CASE WHEN v_imported < p_batch_size THEN 'complete' ELSE cmi.status END,
         completed_at  = CASE WHEN v_imported < p_batch_size THEN now() ELSE cmi.completed_at END
   WHERE cmi.id = p_import_id;

  -- ── 5. Return ──────────────────────────────────────────────────────
  done         := (v_imported < p_batch_size);
  batch_cursor := v_new_cursor;
  imported     := v_imported;
  matched      := v_matched;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.import_core_market_batch(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_core_market_batch(uuid, int) TO service_role;

COMMENT ON FUNCTION public.import_core_market_batch(uuid, int) IS
  'HOR-410: granularity-aware Core Markets import tick. Pages gnaf.address_principal into properties filtered by the import''s granularity (suburb | street | building), skips workspace tombstones (gnaf_import_suppressions), stamps import_granularity + import_source_pid, runs the contact match pass, advances cursor/counters. Returns (done, batch_cursor, imported, matched). Atomic.';
