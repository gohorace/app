-- ============================================================
-- HOR-104  Phase 2b — identified_devices writers
--
-- Extends stitch_contact_from_token (HOR-63) to dual-write an
-- identified_devices row alongside the existing identity_map insert.
-- The form-submit path writes from app code via resolver.ts; this
-- migration only touches the tracked-link path.
--
-- Conflict semantics on (cookie_id) UNIQUE:
--   - Same contact_id → refresh last_seen_at + cookie_expires_at
--   - Different contact_id → leave existing row alone (the existing
--     identity_stitch_history table already audits cookie reassignment;
--     no duplication needed)
-- ============================================================

CREATE OR REPLACE FUNCTION stitch_contact_from_token(
  p_token        text,
  p_workspace_id uuid,
  p_anonymous_id text,
  p_user_agent   text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_contact_id    uuid;
  v_agent_id      uuid;
  v_link_ws       uuid;
  v_prev_contact  uuid;
  v_ua_summary    text;
BEGIN
  IF p_token IS NULL OR p_anonymous_id IS NULL OR p_workspace_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ctl.contact_id, ctl.agent_id, ctl.workspace_id
    INTO v_contact_id, v_agent_id, v_link_ws
    FROM contact_tracked_links ctl
   WHERE ctl.token = p_token;

  IF v_contact_id IS NULL THEN RETURN NULL; END IF;

  -- Guard: token must originate from the same workspace that owns it.
  IF v_link_ws <> p_workspace_id THEN RETURN NULL; END IF;

  -- Existing stitch for this cookie?
  SELECT im.contact_id INTO v_prev_contact
    FROM identity_map im
   WHERE im.workspace_id = p_workspace_id
     AND im.agent_id     = v_agent_id
     AND im.anonymous_id = p_anonymous_id;

  -- Audit cookie reassignments at the identity_map layer (same as today).
  IF v_prev_contact IS NOT NULL AND v_prev_contact <> v_contact_id THEN
    INSERT INTO identity_stitch_history
      (workspace_id, agent_id, anonymous_id, prev_contact_id, new_contact_id, stitch_method)
    VALUES
      (p_workspace_id, v_agent_id, p_anonymous_id, v_prev_contact, v_contact_id, 'email_click');
  END IF;

  -- identity_map: last-write-wins (existing behaviour).
  INSERT INTO identity_map
    (workspace_id, agent_id, anonymous_id, contact_id, stitch_method, confidence)
  VALUES
    (p_workspace_id, v_agent_id, p_anonymous_id, v_contact_id, 'email_click', 'high')
  ON CONFLICT (workspace_id, agent_id, anonymous_id) DO UPDATE
    SET contact_id    = EXCLUDED.contact_id,
        stitch_method = EXCLUDED.stitch_method,
        confidence    = EXCLUDED.confidence;

  -- identified_devices: insert or refresh-on-same-contact.
  -- Different-contact conflicts hit the WHERE clause and leave the row alone;
  -- the cookie reassignment is already logged above via identity_stitch_history.
  v_ua_summary := summarize_user_agent(p_user_agent);

  INSERT INTO identified_devices
    (workspace_id, contact_id, cookie_id, identification_method,
     identified_by_agent_id, user_agent_summary,
     first_identified_at, last_seen_at, cookie_expires_at)
  VALUES
    (p_workspace_id, v_contact_id, p_anonymous_id, 'email_link_click',
     v_agent_id, v_ua_summary,
     now(), now(), now() + interval '12 months')
  ON CONFLICT (cookie_id) DO UPDATE
    SET last_seen_at       = now(),
        cookie_expires_at  = now() + interval '12 months',
        user_agent_summary = COALESCE(identified_devices.user_agent_summary, EXCLUDED.user_agent_summary)
    WHERE identified_devices.contact_id = EXCLUDED.contact_id;

  RETURN v_contact_id;
END;
$$;

-- ============================================================
-- summarize_user_agent(text) → text
--
-- Lightweight UA → category mapping for identified_devices.user_agent_summary.
-- Same logic is mirrored in apps/web/src/lib/identity/identified-devices.ts so
-- TS callers can compute the summary locally without an extra round-trip.
-- Returns 'unknown' if the input is null or unrecognised.
-- ============================================================

CREATE OR REPLACE FUNCTION summarize_user_agent(p_ua text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_ua text;
  v_form text;
  v_engine text;
BEGIN
  IF p_ua IS NULL OR length(trim(p_ua)) = 0 THEN
    RETURN 'unknown';
  END IF;

  v_ua := lower(p_ua);

  -- Form factor
  IF v_ua ~ 'ipad|tablet' THEN
    v_form := 'tablet';
  ELSIF v_ua ~ 'iphone|android.*mobile|mobile' THEN
    v_form := 'mobile';
  ELSE
    v_form := 'desktop';
  END IF;

  -- Browser engine — order matters (edge/opera before chrome before safari)
  IF v_ua ~ 'edg/' THEN
    v_engine := 'edge';
  ELSIF v_ua ~ 'opr/|opera' THEN
    v_engine := 'opera';
  ELSIF v_ua ~ 'firefox' THEN
    v_engine := 'firefox';
  ELSIF v_ua ~ 'chrome' THEN
    v_engine := 'chrome';
  ELSIF v_ua ~ 'safari' THEN
    v_engine := 'safari';
  ELSE
    v_engine := 'other';
  END IF;

  RETURN v_form || '_' || v_engine;
END;
$$;
