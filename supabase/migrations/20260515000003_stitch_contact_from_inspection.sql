-- HOR-147  Doorstep v1 — stitch_contact_from_inspection RPC
--
-- Phone-keyed identity stitch fired by /api/inspections/capture (HOR-152) when
-- a prospect submits the public capture form at /i/<token> (HOR-151). One
-- RPC, four writes, idempotent on repeat submissions:
--
--   1. contacts          — phone match or insert (ingestion_method='inspection_capture')
--   2. inspection_scans  — INSERT ON CONFLICT DO NOTHING on (inspection_id, contact_id)
--   3. events            — form_submit with properties={form,inspection_id,inspection_type,address}
--   4. identified_devices — conflict-aware upsert on cookie_id (mirrors HOR-104 semantics)
--
-- Mirrors stitch_contact_from_token (HOR-63 / HOR-104) but matches on phone
-- instead of token-bound contact, and routes all writes through the
-- inspection's owning agent rather than the workspace default. Cookie
-- reassignments are audited in identity_stitch_history with
-- stitch_method='inspection_capture'.
--
-- ──────────────────────────────────────────────────────────────────────
-- agent_id ↔ owner_agent_id drift (flagged for follow-up):
--
-- Today's app code (resolver.ts, csv import) writes only the legacy
-- contacts.agent_id. Phase 1 (HOR-65) introduced owner_agent_id as the
-- V1 canonical and the new partial indexes (contacts_owner_phone_idx,
-- contacts_owner_email_idx) sit on it — but no production code writes
-- owner_agent_id yet, so the indexes are sparse and lookups by it miss
-- recent rows. This RPC handles both worlds:
--
--   - SELECT uses (agent_id = v_agent_id OR owner_agent_id = v_agent_id)
--     so contacts from either era are reachable.
--   - INSERT sets BOTH columns. Forward-looking; lets the next reconcile
--     pass treat owner_agent_id as authoritative without re-backfilling
--     anything we wrote today.
--
-- This is the safe shape until the team commits to the owner_agent_id
-- transition. Flagged in the HOR-147 PR body as a follow-up.
-- ──────────────────────────────────────────────────────────────────────
--
-- ⚠️ Migration drift: `_migrations` is stale since 2026-04-29. Apply via
-- the Supabase SQL editor in prod, NOT via supabase db push. Same path as
-- 20260515000002_inspections_v1.sql.

BEGIN;

CREATE OR REPLACE FUNCTION stitch_contact_from_inspection(
  p_token        text,
  p_phone        text,          -- E.164 — API layer normalises, RPC trusts
  p_name         text,
  p_anonymous_id text,
  p_session_id   uuid,          -- API layer upserts the session before calling
  p_user_agent   text DEFAULT NULL
)
RETURNS TABLE (
  contact_id   uuid,
  agent_id     uuid,
  workspace_id uuid,
  address      text,
  contact_name text,
  is_new_scan  boolean          -- false on repeat-submit; lets the API layer skip the push
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inspection_id    uuid;
  v_inspection_type  text;
  v_agent_id         uuid;
  v_workspace_id     uuid;
  v_property_id      uuid;
  v_contact_id       uuid;
  v_address          text;
  v_first_name       text;
  v_last_name        text;
  v_ua_summary       text;
  v_now              timestamptz := now();
  v_inserted_scan    boolean := false;
  v_prev_contact     uuid;
  v_contact_name     text;
BEGIN
  IF p_token IS NULL OR p_phone IS NULL OR p_name IS NULL
     OR p_anonymous_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'stitch_contact_from_inspection: missing required argument'
      USING ERRCODE = '22023';
  END IF;

  -- ============================================================
  -- 1. Resolve token → inspection, agent, workspace, property
  -- ============================================================
  SELECT i.id, i.inspection_type, i.agent_id, i.workspace_id, i.property_id
    INTO v_inspection_id, v_inspection_type, v_agent_id, v_workspace_id, v_property_id
    FROM inspections i
   WHERE i.token = p_token
     AND i.deleted_at IS NULL
     AND i.status IN ('scheduled', 'live', 'ended');
  -- 'ended' is intentionally allowed — late submitters (last-to-leave types)
  -- should still get captured. 'cancelled' inspections drop their token.

  IF v_inspection_id IS NULL THEN
    -- API layer translates the no_data_found code to HTTP 404.
    RAISE EXCEPTION 'inspection not found for token' USING ERRCODE = 'P0002';
  END IF;

  -- ============================================================
  -- 2. Derive address string for downstream copy
  --    Shape: "<street_number> <street_name>, <suburb>" with graceful fallback
  -- ============================================================
  SELECT trim(
           regexp_replace(
             coalesce(p.street_number || ' ', '')
               || coalesce(p.street_name, '')
               || coalesce(', ' || p.suburb, ''),
             '^,\s*|,\s*$', '', 'g'
           )
         )
    INTO v_address
    FROM properties p
   WHERE p.id = v_property_id;

  IF v_address IS NULL OR length(v_address) = 0 THEN
    v_address := 'the open home';
  END IF;

  -- ============================================================
  -- 3. Split name (first whitespace = first/last boundary)
  --    Matches CSV importer behaviour: don't guess on single-token names.
  -- ============================================================
  v_first_name := split_part(trim(p_name), ' ', 1);
  IF position(' ' in trim(p_name)) > 0 THEN
    v_last_name := trim(substring(trim(p_name) FROM position(' ' in trim(p_name)) + 1));
  ELSE
    v_last_name := NULL;
  END IF;

  -- ============================================================
  -- 4. Find existing contact by phone (workspace + agent + alive)
  --
  -- agent_id ↔ owner_agent_id drift handled here (see header). The
  -- ORDER BY picks the freshest match if duplicates exist (the partial
  -- phone index is non-unique — duplicate detection is a Phase 2 problem).
  -- ============================================================
  SELECT c.id
    INTO v_contact_id
    FROM contacts c
   WHERE c.workspace_id = v_workspace_id
     AND c.phone = p_phone
     AND c.deleted_at IS NULL
     AND (c.agent_id = v_agent_id OR c.owner_agent_id = v_agent_id)
   ORDER BY c.last_seen_at DESC NULLS LAST, c.created_at DESC
   LIMIT 1;

  -- ============================================================
  -- 5. Insert or refresh contact
  -- ============================================================
  IF v_contact_id IS NULL THEN
    INSERT INTO contacts (
      workspace_id, agent_id, owner_agent_id, created_by_agent_id,
      phone, first_name, last_name, full_name_raw,
      source, ingestion_method,
      identified_at, last_seen_at, created_at, updated_at
    ) VALUES (
      v_workspace_id, v_agent_id, v_agent_id, v_agent_id,
      p_phone, v_first_name, v_last_name, p_name,
      'website', 'inspection_capture',
      v_now, v_now, v_now, v_now
    )
    RETURNING id INTO v_contact_id;
  ELSE
    -- Existing contact: bump last_seen, backfill nulls only (never overwrite).
    UPDATE contacts c
       SET last_seen_at  = v_now,
           updated_at    = v_now,
           identified_at = COALESCE(c.identified_at, v_now),
           first_name    = COALESCE(c.first_name, v_first_name),
           last_name     = COALESCE(c.last_name, v_last_name),
           full_name_raw = COALESCE(c.full_name_raw, p_name)
     WHERE c.id = v_contact_id;
  END IF;

  -- Resolve display name AFTER the upsert so we return whatever's actually
  -- stored (existing contact may already have a richer name than the form).
  SELECT trim(coalesce(c.first_name || ' ', '') || coalesce(c.last_name, ''))
    INTO v_contact_name
    FROM contacts c
   WHERE c.id = v_contact_id;
  IF v_contact_name IS NULL OR length(v_contact_name) = 0 THEN
    v_contact_name := COALESCE(p_name, v_first_name);
  END IF;

  -- ============================================================
  -- 6. Insert scan (idempotent on (inspection_id, contact_id))
  -- ============================================================
  INSERT INTO inspection_scans (
    workspace_id, inspection_id, contact_id, captured_at, cookie_id
  ) VALUES (
    v_workspace_id, v_inspection_id, v_contact_id, v_now, p_anonymous_id
  )
  ON CONFLICT (inspection_id, contact_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted_scan = ROW_COUNT;

  -- ============================================================
  -- 7. Insert form_submit event — only on a fresh scan, otherwise we'd
  --    re-score the same submission every refresh.
  -- ============================================================
  IF v_inserted_scan THEN
    INSERT INTO events (
      workspace_id, session_id, event_type, properties, occurred_at
    ) VALUES (
      v_workspace_id,
      p_session_id,
      'form_submit',
      jsonb_build_object(
        'form',            'inspection',
        'inspection_id',   v_inspection_id,
        'inspection_type', v_inspection_type,
        'address',         v_address
      ),
      v_now
    );
  END IF;

  -- ============================================================
  -- 8. Identified_devices upsert
  --
  -- Mirrors stitch_contact_from_token (HOR-104) semantics:
  --   - Same contact → refresh last_seen + expiry, keep first_identified_at
  --   - Different contact → leave row alone (the ON CONFLICT WHERE filter
  --     blocks the UPDATE), and audit via identity_stitch_history
  -- ============================================================
  v_ua_summary := summarize_user_agent(p_user_agent);

  -- Detect cookie reassignment for audit
  SELECT id.contact_id INTO v_prev_contact
    FROM identified_devices id
   WHERE id.cookie_id = p_anonymous_id;

  IF v_prev_contact IS NOT NULL AND v_prev_contact <> v_contact_id THEN
    INSERT INTO identity_stitch_history (
      workspace_id, agent_id, anonymous_id,
      prev_contact_id, new_contact_id, stitch_method
    ) VALUES (
      v_workspace_id, v_agent_id, p_anonymous_id,
      v_prev_contact, v_contact_id, 'inspection_capture'
    );
  END IF;

  INSERT INTO identified_devices (
    workspace_id, contact_id, cookie_id, identification_method,
    identified_by_agent_id, user_agent_summary,
    first_identified_at, last_seen_at, cookie_expires_at
  ) VALUES (
    v_workspace_id, v_contact_id, p_anonymous_id, 'inspection_capture',
    v_agent_id, v_ua_summary,
    v_now, v_now, v_now + interval '12 months'
  )
  ON CONFLICT (cookie_id) DO UPDATE
    SET last_seen_at       = v_now,
        cookie_expires_at  = v_now + interval '12 months',
        user_agent_summary = COALESCE(identified_devices.user_agent_summary, EXCLUDED.user_agent_summary)
    WHERE identified_devices.contact_id = EXCLUDED.contact_id;

  -- ============================================================
  -- 9. Return resolved tuple
  -- ============================================================
  contact_id   := v_contact_id;
  agent_id     := v_agent_id;
  workspace_id := v_workspace_id;
  address      := v_address;
  contact_name := v_contact_name;
  is_new_scan  := v_inserted_scan;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION stitch_contact_from_inspection(text, text, text, text, uuid, text) IS
  'Doorstep capture stitch — resolves a /i/<token> form submission to a contact, links the device, records the scan, and emits a form_submit event. Idempotent on (token, contact). Returns is_new_scan=false on repeat submits so the API layer can skip dispatching another push. See HOR-147.';

COMMIT;
