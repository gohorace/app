-- ============================================================
-- HOR-232  Property state vocabulary — corrected apply order.
--
-- 20260514000001_property_state_v1.sql (HOR-135) never actually applied on
-- prod, and it can't be applied as-written: it runs
--
--     UPDATE properties SET status = 'watching' WHERE status IN
--       ('off_market','residence_only','withdrawn','unknown') OR status IS NULL;
--
-- BEFORE dropping the old CHECK constraint. While the old 7-value constraint
-- is still active it rejects 'watching', so the UPDATE fails (23514). When
-- HOR-135 first ran there were no rows matching that WHERE (0 rows updated,
-- so it slipped through); the Core Markets QLD G-NAF import (HOR-189) later
-- created properties whose status matches it, so the UPDATE now fires and the
-- migration aborts.
--
-- This migration does the same work in the correct order:
--   1. DROP the old CHECK constraint first.
--   2. Map legacy status values onto the four-value vocabulary
--      ('listed','appraising','watching','sold'), with a catch-all so any
--      stray value can't block the constraint.
--   3. ADD the four-value CHECK constraint.
--   4. CREATE OR REPLACE resolve_residence_property() to insert 'watching'
--      (was 'residence_only') — REQUIRED, or new property creation would
--      insert a value the new constraint rejects.
--
-- Idempotent: in any environment where 20260514000001 did apply, the maps hit
-- 0 rows and the constraint/function are re-asserted identically.
--
-- ⚠️ Migration drift active (HOR-131): apply via the Supabase Studio SQL
--    editor + manual
--      INSERT INTO supabase_migrations.schema_migrations (version)
--        VALUES ('20260527000002');
--    Do NOT `supabase db push`. (You do NOT also need to run 20260514000001 —
--    this supersedes it.)
-- ============================================================

BEGIN;

-- 1. Drop the old constraint FIRST so the data migration can write the new
--    vocabulary ('watching'/'appraising' aren't in the old 7-value set).
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_status_check;

-- 2. Data migration ------------------------------------------------------
UPDATE properties
   SET status = 'listed'
 WHERE status = 'under_offer';

UPDATE properties
   SET status = 'watching'
 WHERE status IN ('off_market', 'residence_only', 'withdrawn', 'unknown')
    OR status IS NULL;

-- Catch-all: any remaining value outside the target vocabulary becomes
-- 'watching' (the brief's placeholder). Guarantees the ADD CONSTRAINT below
-- can't fail on an unexpected legacy value.
UPDATE properties
   SET status = 'watching'
 WHERE status IS NULL
    OR status NOT IN ('listed', 'appraising', 'watching', 'sold');

-- 3. Add the four-value CHECK constraint ---------------------------------
ALTER TABLE properties
  ADD CONSTRAINT properties_status_check
  CHECK (status IN ('listed', 'appraising', 'watching', 'sold'));

-- 4. resolve_residence_property() — insert 'watching' instead of the now
--    dead 'residence_only' on new property creation. (Verbatim from
--    20260514000001; mandatory so creation doesn't violate the new CHECK.)
CREATE OR REPLACE FUNCTION resolve_residence_property(
  p_workspace_id    uuid,
  p_street_number   text DEFAULT NULL,
  p_street_name     text DEFAULT NULL,
  p_suburb          text DEFAULT NULL,
  p_state           text DEFAULT NULL,
  p_postcode        text DEFAULT NULL,
  p_raw             text DEFAULT NULL,
  p_google_place_id text DEFAULT NULL,
  p_latitude        decimal(10, 7) DEFAULT NULL,
  p_longitude       decimal(10, 7) DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_id   uuid;
BEGIN
  -- ---------- Step 1: Google place_id direct lookup ------------------
  IF p_google_place_id IS NOT NULL THEN
    SELECT id INTO v_id
      FROM properties
     WHERE workspace_id = p_workspace_id
       AND google_place_id = p_google_place_id
       AND deleted_at IS NULL;

    IF v_id IS NOT NULL THEN
      UPDATE properties
         SET last_activity_at = now(),
             latitude         = coalesce(latitude,  p_latitude),
             longitude        = coalesce(longitude, p_longitude)
       WHERE id = v_id;
      RETURN v_id;
    END IF;
  END IF;

  -- ---------- Step 2: address hash lookup + insert/enrich ------------
  v_hash := compute_address_hash(
    p_street_number, p_street_name, p_suburb, p_state, p_postcode, p_raw
  );

  IF v_hash IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO properties (
    workspace_id,
    street_number, street_name, suburb, state, postcode,
    address_hash,
    google_place_id, latitude, longitude,
    status, first_seen_at, last_activity_at
  )
  VALUES (
    p_workspace_id,
    p_street_number,
    coalesce(p_street_name, p_raw, '(unknown)'),
    p_suburb,
    p_state,
    p_postcode,
    v_hash,
    p_google_place_id,
    p_latitude,
    p_longitude,
    'watching',                                       -- HOR-135: was 'residence_only'
    now(),
    now()
  )
  ON CONFLICT (workspace_id, address_hash) WHERE deleted_at IS NULL DO UPDATE
    SET last_activity_at = now(),
        google_place_id  = coalesce(properties.google_place_id, EXCLUDED.google_place_id),
        latitude         = coalesce(properties.latitude,        EXCLUDED.latitude),
        longitude        = coalesce(properties.longitude,       EXCLUDED.longitude)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION resolve_residence_property(uuid, text, text, text, text, text, text, text, decimal, decimal) IS
  'Canonical address-resolution RPC. Dedup order: (workspace_id, google_place_id) → (workspace_id, address_hash). Inserts new property rows with status=watching when no match; enriches existing rows with Google data on hit when the row was previously hash-only. CSV import and listing-parser paths continue to call with 7 args (Google params default null) — they fall through to the hash flow unchanged.';

COMMIT;
