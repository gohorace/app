-- ============================================================
-- HOR-193  Core Markets — import batch RPC
--
-- import_core_market_batch(p_import_id, p_batch_size) does one tick
-- of the import worker:
--
--   1. INSERT...SELECT a page of gnaf.address_principal rows into
--      public.properties for the import's workspace, computing
--      address_hash inline via the existing compute_address_hash()
--      from 20260511000004. ON CONFLICT (workspace_id, address_hash)
--      DO UPDATE attaches the gnaf pid to a property that was already
--      created via resolve_residence_property() (e.g. from a CSV
--      import) — so we never duplicate per-workspace rows.
--
--   2. Match pass — UPDATE contacts.residence_property_id where the
--      contact's normalised (suburb + property_address) hash matches
--      a property in the newly-imported set AND the contact doesn't
--      already have a residence. Exact match after normalisation,
--      no fuzzy matching (per brief).
--
--   3. Update the core_market_imports row: bump batch_cursor,
--      counters, heartbeat_at. If we returned fewer rows than the
--      batch_size, flip status='complete' + completed_at=now().
--
--   4. Return (done, batch_cursor, imported, matched) so the route
--      can dispatch the import-complete notification when done.
--
-- Atomic — all of (1)+(2)+(3) inside the function, single transaction.
-- If anything throws, the whole tick rolls back and the next pg_cron
-- tick will retry from the same cursor.
--
-- Lives in HOR-193 (not HOR-192) because the surrounding worker
-- route + pg_cron schedule + notification dispatch ship in the same
-- PR. Service-role grant only.
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
  --
  -- The `built` CTE projects each gnaf row into the properties column
  -- set (with the same case-folding as the contact-create path so the
  -- address_hash matches exactly). `inserted` runs the upsert and
  -- returns the resulting (address_hash, id) pairs — we collect the
  -- hashes for the match pass and count rows for the cursor + counters.
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
      -- Mirror the (number_first + flat_number) pattern from the
      -- ingest script — keeps the address_hash consistent with
      -- contact-create-side hashing.
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
  -- PSMA ships alias address_detail_pids that collapse to the same
  -- (street_number, street_name, suburb, state, postcode) tuple — i.e.
  -- two source rows produce the same address_hash. Without dedupe,
  -- the INSERT ... ON CONFLICT DO UPDATE bombs out with PostgreSQL
  -- error 21000 ("ON CONFLICT DO UPDATE command cannot affect row a
  -- second time") because a single statement can update each target
  -- row at most once. Dedupe within the batch, keeping the lowest
  -- detail_pid for stability so re-runs are deterministic.
  --
  -- Caught during the first prod run 2026-05-18 at batch_size=2000.
  -- A longer-term fix would filter aliases out in the ingest script
  -- itself (WHERE alias_principal = 'P'), avoiding the duplication
  -- in gnaf.address_principal entirely.
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
      'residence_only',
      now(), now()
    FROM deduped d
    -- The unique index is `(workspace_id, address_hash) WHERE deleted_at IS NULL`.
    -- ON CONFLICT requires the matching predicate.
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
      -- Use src count rather than inserted count so `done` stays accurate.
      -- Dedupe can collapse a batch below p_batch_size; we'd otherwise
      -- think the import was done when we still have source rows to page.
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
  --
  -- Workspace contacts that don't already have a residence and whose
  -- normalised (suburb + property_address) hash matches a property in
  -- the just-imported set. The hash function is the SAME one used by
  -- resolve_residence_property — match parity is guaranteed by reusing
  -- compute_address_hash. Exact match only, no fuzzy.
  --
  -- contact_property_relationships writes are deferred to HOR-198 —
  -- V1 only sets residence_property_id, which is what the Properties
  -- UI uses for the "Linked contacts" display.
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
  --
  -- `done` semantics: we processed strictly fewer rows than the batch
  -- size, so there's no more source data after the new cursor. Flip
  -- to 'complete' and stamp completed_at. heartbeat_at gets refreshed
  -- whether we're done or not so the claim RPC's stuck-detection works.
  --
  -- Table aliased to `cmi` so column refs are unambiguous — RETURNS
  -- TABLE (done, batch_cursor, ...) declares those names as OUT
  -- parameters inside the function body, which would otherwise collide
  -- with `core_market_imports.batch_cursor` and trigger error 42702.
  -- Caught during the first real prod run 2026-05-18.
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
  'HOR-193: one tick of the Core Markets import worker. Bulk-loads a page of gnaf.address_principal into properties (dedup against existing rows via address_hash unique index), runs the auto-match pass against contacts, updates the import row state. Returns (done, batch_cursor, imported, matched). Atomic — full rollback on any error.';
