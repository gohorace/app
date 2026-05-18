-- ============================================================
-- HOR-221  Fix stitch_contact_from_inspection PL/pgSQL ambiguity
--
-- The RPC's `RETURNS TABLE` clause declares OUT parameters with
-- column-shaped names: `contact_id`, `agent_id`, `workspace_id`,
-- `address`, `contact_name`, `is_new_scan`. PL/pgSQL puts those
-- names into the same scope as table columns, and the function body
-- runs:
--
--   INSERT INTO inspection_scans (...)
--   ON CONFLICT (inspection_id, contact_id) DO NOTHING;
--
-- where `contact_id` is both the conflict-target column AND an OUT
-- parameter. PL/pgSQL refuses to guess and throws SQLSTATE 42702
-- ("column reference 'contact_id' is ambiguous"). Every prod capture
-- submit since HOR-147 shipped has failed with that error — invisibly
-- behind the form's generic "Could not complete sign-in." copy.
-- HOR-204's custom-domain rewrite finally got real attendees to the
-- capture page, and the bug surfaced on the first real submission.
--
-- Fix: add `#variable_conflict use_column` at the top of the
-- function body. That tells PL/pgSQL "when an identifier could be
-- either a variable or a column, prefer the column." Safe here
-- because every local variable in the function is `v_`-prefixed —
-- only the OUT params clash, and they're never referenced from SQL
-- statements inside the body (they're only assigned at the bottom
-- via PL/pgSQL `:=`, which is unambiguous).
--
-- Body is otherwise identical to the original 20260515000003 RPC.
-- Hotfix was already applied via Studio CREATE OR REPLACE to unblock
-- the prod smoke; this migration is the repo-tracked version that
-- agrees with what's in the database.
--
-- ⚠️ Migration drift: supabase_migrations.schema_migrations is
-- reconciled through 20260518000020. Apply via Studio + manual INSERT
-- of '20260518000030', not `supabase db push`, until HOR-131 clears
-- the legacy.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION stitch_contact_from_inspection(
  p_token        text,
  p_phone        text,
  p_name         text,
  p_anonymous_id text,
  p_session_id   uuid,
  p_user_agent   text DEFAULT NULL
)
RETURNS TABLE (
  contact_id   uuid,
  agent_id     uuid,
  workspace_id uuid,
  address      text,
  contact_name text,
  is_new_scan  boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
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

  SELECT i.id, i.inspection_type, i.agent_id, i.workspace_id, i.property_id
    INTO v_inspection_id, v_inspection_type, v_agent_id, v_workspace_id, v_property_id
    FROM inspections i
   WHERE i.token = p_token
     AND i.deleted_at IS NULL
     AND i.status IN ('scheduled', 'live', 'ended');

  IF v_inspection_id IS NULL THEN
    RAISE EXCEPTION 'inspection not found for token' USING ERRCODE = 'P0002';
  END IF;

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

  v_first_name := split_part(trim(p_name), ' ', 1);
  IF position(' ' in trim(p_name)) > 0 THEN
    v_last_name := trim(substring(trim(p_name) FROM position(' ' in trim(p_name)) + 1));
  ELSE
    v_last_name := NULL;
  END IF;

  SELECT c.id
    INTO v_contact_id
    FROM contacts c
   WHERE c.workspace_id = v_workspace_id
     AND c.phone = p_phone
     AND c.deleted_at IS NULL
     AND (c.agent_id = v_agent_id OR c.owner_agent_id = v_agent_id)
   ORDER BY c.last_seen_at DESC NULLS LAST, c.created_at DESC
   LIMIT 1;

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
    UPDATE contacts c
       SET last_seen_at  = v_now,
           updated_at    = v_now,
           identified_at = COALESCE(c.identified_at, v_now),
           first_name    = COALESCE(c.first_name, v_first_name),
           last_name     = COALESCE(c.last_name, v_last_name),
           full_name_raw = COALESCE(c.full_name_raw, p_name)
     WHERE c.id = v_contact_id;
  END IF;

  SELECT trim(coalesce(c.first_name || ' ', '') || coalesce(c.last_name, ''))
    INTO v_contact_name
    FROM contacts c
   WHERE c.id = v_contact_id;
  IF v_contact_name IS NULL OR length(v_contact_name) = 0 THEN
    v_contact_name := COALESCE(p_name, v_first_name);
  END IF;

  INSERT INTO inspection_scans (
    workspace_id, inspection_id, contact_id, captured_at, cookie_id
  ) VALUES (
    v_workspace_id, v_inspection_id, v_contact_id, v_now, p_anonymous_id
  )
  ON CONFLICT (inspection_id, contact_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted_scan = ROW_COUNT;

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

  v_ua_summary := summarize_user_agent(p_user_agent);

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
  'HOR-221: as 20260515000003 with #variable_conflict use_column to resolve PL/pgSQL ambiguity between OUT params (contact_id, agent_id, workspace_id) and like-named table columns in the function body.';

COMMIT;
