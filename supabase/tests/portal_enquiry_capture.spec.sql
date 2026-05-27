-- ============================================================
-- HOR-233 / HOR-235 — portal_enquiry_capture migration tests
--
-- Covers 20260527000001_portal_enquiry_capture.sql (widens the
-- events.event_type and notification_log.type CHECK constraints) and
-- asserts the contact-anchored get_contact_events path surfaces a
-- portal_enquiry event.
--
-- Run via the Supabase Studio SQL editor (admin / service-role context).
-- Wrapped in BEGIN … ROLLBACK so it leaves no data behind.
--
-- No pgTAP installed (matches doorstep_destinations.spec.sql) — DO blocks
-- with RAISE EXCEPTION on failure, RAISE NOTICE on pass.
--
-- ⚠️ Requires admin/postgres role:
--   • INSERT into auth.users to satisfy agents.user_id FK.
--   • The migration must already be applied before running this file.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_workspace_id uuid;
  v_user_id      uuid := gen_random_uuid();
  v_agent_id     uuid;
  v_contact_id   uuid;
  v_event_id     uuid;
  v_notif_id     uuid;
  v_count        int;
BEGIN

  -- ──────────────────────────────────────────────────────────
  -- Setup: minimal workspace + agent + contact
  -- ──────────────────────────────────────────────────────────

  INSERT INTO workspaces (name, slug, snippet_key)
  VALUES (
    'HOR-233 Test Workspace',
    'hor233-test-' || floor(random() * 99999)::text,
    gen_random_uuid()
  )
  RETURNING id INTO v_workspace_id;

  -- agents.user_id references auth.users(id) — insert a stub row.
  INSERT INTO auth.users (
    id, email, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, aud, role
  ) VALUES (
    v_user_id,
    'hor233-test-' || floor(random() * 99999)::text || '@example.test',
    now(), now(),
    '{"provider":"email","providers":["email"]}', '{}',
    false, 'authenticated', 'authenticated'
  );

  INSERT INTO agents (workspace_id, user_id, email, first_name)
  VALUES (v_workspace_id, v_user_id, 'agent@example.test', 'HOR233Test')
  RETURNING id INTO v_agent_id;

  -- contacts.agent_id is the required FK; source defaults to 'manual'.
  INSERT INTO contacts (agent_id, email, first_name, last_name, source, ingestion_method)
  VALUES (v_agent_id, 'lead@example.test', 'Sarah', 'Chen', 'portal', 'portal_enquiry')
  RETURNING id INTO v_contact_id;

  -- ══════════════════════════════════════════════════════════
  -- 1. events.event_type accepts 'portal_enquiry' (contact-anchored:
  --    contact_id set, session_id NULL — satisfies the
  --    events_session_or_contact check).
  -- ══════════════════════════════════════════════════════════
  INSERT INTO events (
    workspace_id, session_id, contact_id, event_type, properties,
    occurred_at, attributed_agent_id
  ) VALUES (
    v_workspace_id, NULL, v_contact_id, 'portal_enquiry',
    jsonb_build_object(
      'listing_address', '12 Maple St',
      'source_portal', 'rea'
    ),
    now(), v_agent_id
  )
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'FAIL 1: portal_enquiry event insert returned NULL id';
  END IF;
  RAISE NOTICE 'PASS 1: events.event_type accepts portal_enquiry';

  -- ══════════════════════════════════════════════════════════
  -- 2. get_contact_events surfaces the portal_enquiry event for the
  --    contact (contact-anchored UNION path, 20260519000003).
  -- ══════════════════════════════════════════════════════════
  SELECT count(*) INTO v_count
  FROM get_contact_events(v_contact_id)
  WHERE event_type = 'portal_enquiry';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL 2: get_contact_events returned % portal_enquiry rows, expected 1', v_count;
  END IF;
  RAISE NOTICE 'PASS 2: get_contact_events surfaces portal_enquiry on the contact timeline';

  -- ══════════════════════════════════════════════════════════
  -- 3. notification_log.type accepts 'alert_portal_enquiry'.
  -- ══════════════════════════════════════════════════════════
  INSERT INTO notification_log (agent_id, contact_id, type, title, body, url)
  VALUES (
    v_agent_id, v_contact_id, 'alert_portal_enquiry',
    'Sarah just enquired on 12 Maple St via REA',
    'Horace has set Sarah up — first reply via Horace and he''ll start watching properly.',
    '/contacts/' || v_contact_id::text
  )
  RETURNING id INTO v_notif_id;

  IF v_notif_id IS NULL THEN
    RAISE EXCEPTION 'FAIL 3: alert_portal_enquiry notification_log insert returned NULL id';
  END IF;
  RAISE NOTICE 'PASS 3: notification_log.type accepts alert_portal_enquiry';

  -- ══════════════════════════════════════════════════════════
  -- 4. The old/other event_type values still pass (regression guard).
  -- ══════════════════════════════════════════════════════════
  INSERT INTO events (workspace_id, session_id, contact_id, event_type, occurred_at)
  VALUES (v_workspace_id, NULL, v_contact_id, 'email_opened', now());
  RAISE NOTICE 'PASS 4: pre-existing event_type values still accepted';

  RAISE NOTICE 'ALL PORTAL ENQUIRY CAPTURE TESTS PASSED';
END $$;

ROLLBACK;
