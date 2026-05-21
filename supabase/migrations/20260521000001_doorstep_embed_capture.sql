-- ============================================================
-- HOR-284  Doorstep website embed — capture backend
--
-- The embed is a same-origin name+mobile form an agent pastes on their own
-- site. It mirrors the inspection capture (stitch_contact_from_inspection,
-- HOR-147/221) but has no inspection. This migration:
--
--   1. widens three CHECK enums to add the embed values
--   2. creates stitch_contact_core — the surface-agnostic sovereign-record
--      core (phone-keyed contact upsert + form_submit event + conflict-aware
--      identified_devices stitch with reassignment audit), extracted so the
--      embed (and, in a later cleanup, the inspection RPC) share one path
--   3. creates stitch_contact_from_embed — resolves the workspace by
--      snippet_key, owns the contact under the workspace default agent,
--      delegates to the core, and (unlike inspection) writes identity_map.
--      The embed runs first-party on the agent's domain, so binding the
--      anonymous_id → contact in identity_map is what lets the tracker
--      attribute the visitor's *subsequent* page views to this named
--      contact. That native same-origin attribution is the whole point of
--      the embed — the cross-origin inspection capture can't do it.
--
-- stitch_contact_from_inspection is intentionally LEFT UNTOUCHED here.
-- Migrating it onto stitch_contact_core is a separate, separately
-- smoke-tested change so the live capture path stays exactly as-is for
-- this ship (there are no SQL-level tests; an inspection regression would
-- only surface in prod).
--
-- ⚠️ Migration drift: supabase_migrations.schema_migrations is reconciled
-- through 20260513000010. Apply via the Studio SQL editor + manual INSERT
-- of '20260521000001', NOT supabase db push, until HOR-131.
-- ============================================================

BEGIN;

-- ── 1. enum widenings ────────────────────────────────────────────────
-- Re-add the full lists (last touched: ingestion_method/identification_method
-- by 20260515000002, notification_log.type by 20260517000006) + the embed value.

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_ingestion_method_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_ingestion_method_check
  CHECK (ingestion_method IN (
    'csv_import', 'crm_sync_rex', 'crm_sync_agentbox', 'crm_sync_vaultre',
    'manual', 'identified_visitor', 'form_submit', 'portal_enquiry',
    'inspection_capture', 'embed_capture'
  ));

ALTER TABLE identified_devices DROP CONSTRAINT IF EXISTS identified_devices_identification_method_check;
ALTER TABLE identified_devices ADD CONSTRAINT identified_devices_identification_method_check
  CHECK (identification_method IN (
    'email_link_click', 'form_submit', 'login', 'manual_merge',
    'inspection_capture', 'embed_capture'
  ));

ALTER TABLE notification_log DROP CONSTRAINT IF EXISTS notification_log_type_check;
ALTER TABLE notification_log ADD CONSTRAINT notification_log_type_check
  CHECK (type IN (
    'email_daily_brief', 'alert_score_threshold', 'alert_form_submit',
    'alert_return_visit', 'email_workspace_invite', 'volume_review',
    'alert_inspection_capture', 'alert_inspection_revisit',
    'core_markets_import_complete', 'alert_embed_capture'
  ));

-- ── 2. stitch_contact_core ────────────────────────────────────────────
-- Surface-agnostic. Mirrors the contact/device/event block of
-- stitch_contact_from_inspection (HOR-221) exactly; the caller supplies the
-- workspace/agent, the ingestion/identification/stitch method strings, and
-- the event properties, so this stays free of any surface-specific logic.
-- NOTE: emits one form_submit event per call (no scan-style idempotency) —
-- the caller is responsible for rate-limiting rapid duplicate submits.
CREATE OR REPLACE FUNCTION stitch_contact_core(
  p_workspace_id          uuid,
  p_agent_id              uuid,
  p_phone                 text,
  p_name                  text,
  p_anonymous_id          text,
  p_session_id            uuid,
  p_user_agent            text,
  p_ingestion_method      text,
  p_identification_method text,
  p_stitch_method         text,
  p_event_properties      jsonb
)
RETURNS TABLE (
  contact_id     uuid,
  contact_name   text,
  is_new_contact boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_contact_id   uuid;
  v_first_name   text;
  v_last_name    text;
  v_contact_name text;
  v_ua_summary   text;
  v_prev_contact uuid;
  v_now          timestamptz := now();
  v_is_new       boolean := false;
BEGIN
  IF p_workspace_id IS NULL OR p_agent_id IS NULL OR p_phone IS NULL
     OR p_name IS NULL OR p_anonymous_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'stitch_contact_core: missing required argument'
      USING ERRCODE = '22023';
  END IF;

  -- name split (first whitespace = first/last boundary)
  v_first_name := split_part(trim(p_name), ' ', 1);
  IF position(' ' in trim(p_name)) > 0 THEN
    v_last_name := trim(substring(trim(p_name) FROM position(' ' in trim(p_name)) + 1));
  ELSE
    v_last_name := NULL;
  END IF;

  -- find existing contact by phone (workspace + agent + alive)
  SELECT c.id INTO v_contact_id
    FROM contacts c
   WHERE c.workspace_id = p_workspace_id
     AND c.phone = p_phone
     AND c.deleted_at IS NULL
     AND (c.agent_id = p_agent_id OR c.owner_agent_id = p_agent_id)
   ORDER BY c.last_seen_at DESC NULLS LAST, c.created_at DESC
   LIMIT 1;

  IF v_contact_id IS NULL THEN
    INSERT INTO contacts (
      workspace_id, agent_id, owner_agent_id, created_by_agent_id,
      phone, first_name, last_name, full_name_raw,
      source, ingestion_method,
      identified_at, last_seen_at, created_at, updated_at
    ) VALUES (
      p_workspace_id, p_agent_id, p_agent_id, p_agent_id,
      p_phone, v_first_name, v_last_name, p_name,
      'website', p_ingestion_method,
      v_now, v_now, v_now, v_now
    )
    RETURNING id INTO v_contact_id;
    v_is_new := true;
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
    INTO v_contact_name FROM contacts c WHERE c.id = v_contact_id;
  IF v_contact_name IS NULL OR length(v_contact_name) = 0 THEN
    v_contact_name := COALESCE(p_name, v_first_name);
  END IF;

  -- form_submit event
  INSERT INTO events (workspace_id, session_id, event_type, properties, occurred_at)
  VALUES (p_workspace_id, p_session_id, 'form_submit', COALESCE(p_event_properties, '{}'::jsonb), v_now);

  -- identified_devices upsert (mirrors HOR-104/147 semantics) + reassignment audit
  v_ua_summary := summarize_user_agent(p_user_agent);

  SELECT id.contact_id INTO v_prev_contact
    FROM identified_devices id WHERE id.cookie_id = p_anonymous_id;

  IF v_prev_contact IS NOT NULL AND v_prev_contact <> v_contact_id THEN
    INSERT INTO identity_stitch_history (
      workspace_id, agent_id, anonymous_id, prev_contact_id, new_contact_id, stitch_method
    ) VALUES (
      p_workspace_id, p_agent_id, p_anonymous_id, v_prev_contact, v_contact_id, p_stitch_method
    );
  END IF;

  INSERT INTO identified_devices (
    workspace_id, contact_id, cookie_id, identification_method,
    identified_by_agent_id, user_agent_summary,
    first_identified_at, last_seen_at, cookie_expires_at
  ) VALUES (
    p_workspace_id, v_contact_id, p_anonymous_id, p_identification_method,
    p_agent_id, v_ua_summary, v_now, v_now, v_now + interval '12 months'
  )
  ON CONFLICT (cookie_id) DO UPDATE
    SET last_seen_at       = v_now,
        cookie_expires_at  = v_now + interval '12 months',
        user_agent_summary = COALESCE(identified_devices.user_agent_summary, EXCLUDED.user_agent_summary)
    WHERE identified_devices.contact_id = EXCLUDED.contact_id;

  contact_id     := v_contact_id;
  contact_name   := v_contact_name;
  is_new_contact := v_is_new;
  RETURN NEXT;
END;
$$;

-- ── 3. stitch_contact_from_embed ──────────────────────────────────────
CREATE OR REPLACE FUNCTION stitch_contact_from_embed(
  p_snippet_key  uuid,
  p_phone        text,          -- E.164 — API layer normalises
  p_name         text,
  p_anonymous_id text,
  p_session_id   uuid,          -- API layer upserts the session first
  p_page_url     text DEFAULT NULL,
  p_user_agent   text DEFAULT NULL
)
RETURNS TABLE (
  contact_id     uuid,
  agent_id       uuid,
  workspace_id   uuid,
  contact_name   text,
  is_new_contact boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_workspace_id uuid;
  v_agent_id     uuid;
  v_core         record;
BEGIN
  IF p_snippet_key IS NULL OR p_phone IS NULL OR p_name IS NULL
     OR p_anonymous_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'stitch_contact_from_embed: missing required argument'
      USING ERRCODE = '22023';
  END IF;

  -- Resolve workspace by snippet_key; own the contact under the workspace
  -- default agent (matches /api/identity's no-email-match fallback).
  SELECT w.id, w.default_agent_id
    INTO v_workspace_id, v_agent_id
    FROM workspaces w
   WHERE w.snippet_key = p_snippet_key;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace not found for snippet_key' USING ERRCODE = 'P0002';
  END IF;
  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'workspace has no default agent' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_core FROM stitch_contact_core(
    v_workspace_id, v_agent_id, p_phone, p_name, p_anonymous_id, p_session_id, p_user_agent,
    'embed_capture', 'embed_capture', 'embed_capture',
    jsonb_build_object('form', 'embed', 'page_url', p_page_url)
  );

  -- identity_map binding (same-origin native attribution — see header).
  -- stitch_method 'form' is the closest existing value (CHECK allows
  -- form|email_click|manual). Latest identification wins on conflict.
  INSERT INTO identity_map (workspace_id, agent_id, anonymous_id, contact_id, stitch_method, confidence)
  VALUES (v_workspace_id, v_agent_id, p_anonymous_id, v_core.contact_id, 'form', 'high')
  ON CONFLICT (workspace_id, agent_id, anonymous_id)
    DO UPDATE SET contact_id = EXCLUDED.contact_id, stitch_method = 'form', confidence = 'high';

  contact_id     := v_core.contact_id;
  agent_id       := v_agent_id;
  workspace_id   := v_workspace_id;
  contact_name   := v_core.contact_name;
  is_new_contact := v_core.is_new_contact;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION stitch_contact_core(uuid,uuid,text,text,text,uuid,text,text,text,text,jsonb) IS
  'HOR-284: surface-agnostic sovereign-record core — phone-keyed contact upsert + form_submit event + identified_devices stitch w/ reassignment audit. Used by stitch_contact_from_embed; stitch_contact_from_inspection to be migrated onto it in a follow-up.';
COMMENT ON FUNCTION stitch_contact_from_embed(uuid,text,text,text,uuid,text,text) IS
  'HOR-284: Doorstep website-embed capture — resolves workspace by snippet_key, owns the contact under the workspace default agent, delegates to stitch_contact_core, and writes identity_map so the agent-site tracker attributes the visitor''s later page views to this contact. ingestion_method=embed_capture.';

COMMIT;
