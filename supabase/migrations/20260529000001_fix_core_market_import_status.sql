-- HOR-330  Core Markets GNAF import broken — properties_status_check (23514)
--
-- HOR-232 (20260527000002) moved properties to the 4-value status vocabulary
-- ('listed','appraising','watching','sold') and updated resolve_residence_property()
-- to insert 'watching' instead of the now-dead 'residence_only'. It MISSED
-- import_core_market_batch() (the Core Markets GNAF import RPC, 20260517000010),
-- which still inserts status='residence_only'. Since 2026-05-28 every GNAF import
-- aborts with:
--
--   [23514] new row for relation "properties" violates check constraint
--           "properties_status_check"   (status = 'residence_only')
--
-- Fix: the same one-token change HOR-232 made to the sibling function —
-- import_core_market_batch now inserts status='watching' (the vocabulary's
-- placeholder for a passively-known address, and exactly what residence_only
-- maps to in 20260527000002's data migration). Then re-enqueue the imports that
-- errored on this so they reprocess cleanly.
--
-- The function body is otherwise VERBATIM from 20260517000010 (no later
-- redefinition exists); only the status literal on the INSERT changed.
--
-- ⚠️ Migration drift: apply via Studio SQL editor + manual INSERT of
-- '20260529000001', NOT `supabase db push`, until HOR-131.

BEGIN;

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
  v_workspace_id uuid;
  v_locality_pid text;
  v_cursor       text;
  v_new_hashes   text[];
  v_imported     int;
  v_matched      int;
  v_new_cursor   text;
BEGIN
  -- ── 1. Fetch import job context ────────────────────────────────────
  SELECT cmi.workspace_id, cmi.locality_pid, cmi.batch_cursor
    INTO v_workspace_id, v_locality_pid, v_cursor
    FROM core_market_imports cmi
   WHERE cmi.id = p_import_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'import_core_market_batch: import % not found', p_import_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ── 2. Bulk INSERT from gnaf.address_principal into properties ────
  WITH src AS (
    SELECT ap.*
      FROM gnaf.address_principal ap
     WHERE ap.locality_pid = v_locality_pid
       AND (v_cursor IS NULL OR ap.address_detail_pid > v_cursor)
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
      address_hash, status, first_seen_at, last_activity_at
    )
    SELECT
      d.workspace_id,
      d.gnaf_address_detail_pid,
      d.street_number, d.street_name, d.suburb, d.state, d.postcode,
      d.latitude, d.longitude,
      d.computed_hash,
      'watching',   -- HOR-330: was 'residence_only' (dropped from the status vocab by HOR-232)
      now(), now()
    FROM deduped d
    ON CONFLICT (workspace_id, address_hash) WHERE deleted_at IS NULL DO UPDATE
      SET gnaf_address_detail_pid = COALESCE(properties.gnaf_address_detail_pid, EXCLUDED.gnaf_address_detail_pid),
          latitude         = COALESCE(properties.latitude,  EXCLUDED.latitude),
          longitude        = COALESCE(properties.longitude, EXCLUDED.longitude),
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
  'HOR-193/HOR-330: one tick of the Core Markets import worker. Bulk-loads gnaf.address_principal into properties (status=watching), runs the auto-match pass, updates the import row. Returns (done, batch_cursor, imported, matched). Atomic.';

-- ── Recover the imports that errored on the old 'residence_only' status.
-- Reset to pending + clear the cursor so the worker reprocesses from scratch
-- (rows_imported was 0 on every failed row). Only touches errored rows.
UPDATE core_market_imports
   SET status        = 'pending',
       error_message = NULL,
       batch_cursor  = NULL,
       rows_imported = 0,
       rows_matched  = 0,
       started_at    = NULL,
       completed_at  = NULL,
       heartbeat_at  = NULL
 WHERE status = 'error'
   AND error_message LIKE '%properties_status_check%';

COMMIT;
