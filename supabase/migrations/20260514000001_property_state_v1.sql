-- ============================================================
-- HOR-135  Property state vocabulary — V1 relationship-first model.
--
-- Brings properties.status in line with the V1 brief:
--   Allowed values: 'listed', 'appraising', 'watching', 'sold'.
--
-- Migration steps
--   1. Map existing values onto the new vocabulary.
--      'off_market'     → 'watching'   (closest semantic match)
--      'residence_only' → 'watching'   (placeholder until the agent
--                                       picks a real relationship)
--      'withdrawn'      → 'watching'   (no longer listed; agent may
--                                       still be tracking)
--      'unknown'        → 'watching'   (placeholder)
--      NULL             → 'watching'   (placeholder)
--      'under_offer'    → 'listed'     (still on the market, just
--                                       contracted — sold-status not
--                                       yet appropriate)
--   2. Swap the CHECK constraint to the four-value vocabulary.
--   3. Update resolve_residence_property() to insert 'watching' on
--      new property creation (was 'residence_only').
--
-- The 'residence_only' literal is no longer valid post-migration; the
-- POST /api/properties code path is updated in the same PR so callers
-- never send the dead value.
-- ============================================================

BEGIN;

-- 1. Data migration -------------------------------------------------------

UPDATE properties
   SET status = 'listed'
 WHERE status = 'under_offer';

UPDATE properties
   SET status = 'watching'
 WHERE status IN ('off_market', 'residence_only', 'withdrawn', 'unknown')
    OR status IS NULL;

-- 2. CHECK constraint swap ------------------------------------------------

ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_status_check;

ALTER TABLE properties
  ADD CONSTRAINT properties_status_check
  CHECK (status IN ('listed', 'appraising', 'watching', 'sold'));

-- 3. resolve_residence_property() — insert 'watching' instead of
--    'residence_only' when a new property row is created. Function
--    signature unchanged; comment refreshed.

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
