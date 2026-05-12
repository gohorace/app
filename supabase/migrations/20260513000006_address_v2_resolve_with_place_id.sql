-- ============================================================
-- HOR-117  Address Autocomplete v2 — Slice 2: resolve_residence_property
--          accepts Google place_id, latitude, longitude.
--
-- Updates the address-resolution RPC to:
--   1. Look up by (workspace_id, google_place_id) first when one is
--      provided. Hit → return existing id (and enrich lat/lng if absent).
--   2. Fall back to the existing (workspace_id, address_hash) flow.
--      On hash hit: enrich google_place_id / latitude / longitude if
--      the existing row has them null (preserves any prior Google data).
--   3. No match → insert a new row with all provided fields.
--
-- Postgres function identity = (name, arg types), so the old 7-arg
-- overload must be DROP-ped before CREATE-ing the new 10-arg version.
-- Otherwise both coexist and PostgREST raises PGRST203 on any 7-arg
-- call site (same failure pattern as create_workspace_with_agent).
--
-- See https://linear.app/gohorace/issue/HOR-117
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS resolve_residence_property(
  uuid, text, text, text, text, text, text
);

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
      -- Hit. Refresh last_activity_at and back-fill lat/lng if absent.
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
    -- No structured components and no raw fallback → cannot resolve.
    RETURN NULL;
  END IF;

  -- Insert or update on hash. On hash hit:
  --   • Always refresh last_activity_at.
  --   • Fill in google_place_id / latitude / longitude IF the existing row
  --     has them null (coalesce(existing, new) — existing wins).
  -- street_name carries the canonical text for partial inputs (the brief
  -- allowed nullable suburb/state/postcode after Phase 2c).
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
    'residence_only',
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
  'Canonical address-resolution RPC. Dedup order: (workspace_id, google_place_id) → (workspace_id, address_hash). Inserts new properties.residence_only rows when no match; enriches existing rows with Google data on hit when the row was previously hash-only. CSV import and listing-parser paths continue to call with 7 args (Google params default null) — they fall through to the hash flow unchanged.';

COMMIT;
