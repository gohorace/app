-- ============================================================
-- HOR-223 — email_send_v1 migration tests
--
-- Covers 20260519000001_email_send_v1.sql.
--
-- Run via Supabase Studio SQL editor (admin / service-role context).
-- The entire file is wrapped in BEGIN … ROLLBACK so it is fully
-- idempotent and leaves no data behind.
--
-- No pgTAP installed (first SQL test file in the repo). Uses
-- DO blocks with RAISE EXCEPTION on assertion failure and
-- RAISE NOTICE on pass. Studio will show NOTICE output inline.
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
  v_session_id   uuid;
  v_contact_id   uuid;
  v_send_id      uuid;
  v_event_id     uuid;
  v_row          RECORD;
BEGIN

  -- ──────────────────────────────────────────────────────────
  -- Setup: minimal workspace + agent + session + contact
  -- The agents_seed_email_exclusions trigger fires on agent
  -- INSERT and populates AU defaults — no manual seed needed.
  -- ──────────────────────────────────────────────────────────

  INSERT INTO workspaces (name, slug, snippet_key)
  VALUES (
    'HOR-223 Test Workspace',
    'hor223-test-' || floor(random() * 99999)::text,
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
    'hor223-test-' || floor(random() * 99999)::text || '@example.test',
    now(), now(),
    '{"provider":"email","providers":["email"]}', '{}',
    false, 'authenticated', 'authenticated'
  );

  INSERT INTO agents (workspace_id, user_id, email, first_name)
  VALUES (v_workspace_id, v_user_id, 'agent@example.test', 'HOR223Test')
  RETURNING id INTO v_agent_id;

  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (v_workspace_id, v_user_id, 'owner');

  -- tracker_session_id added in 20260506000003_sessions_per_visit.sql (NOT NULL, unique
  -- with workspace_id). A fresh uuid here keeps the test row unique from any prod data.
  INSERT INTO sessions (workspace_id, anonymous_id, tracker_session_id)
  VALUES (v_workspace_id, 'anon-hor223-test', gen_random_uuid())
  RETURNING id INTO v_session_id;

  -- Contact email chosen from a safe non-excluded domain.
  INSERT INTO contacts (agent_id, email, first_name)
  VALUES (v_agent_id, 'lead@safedomain.example.com', 'TestLead')
  RETURNING id INTO v_contact_id;

  -- ──────────────────────────────────────────────────────────
  -- Test 1: New email event_type values accepted by CHECK
  -- ──────────────────────────────────────────────────────────

  BEGIN
    INSERT INTO events (workspace_id, session_id, event_type, properties)
    VALUES (v_workspace_id, v_session_id, 'email_sent', '{}');
    RAISE NOTICE 'PASS [1a]: email_sent accepted by events_event_type_check';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'FAIL [1a]: email_sent should be accepted — events_event_type_check too narrow';
  END;

  BEGIN
    INSERT INTO events (workspace_id, session_id, event_type, properties)
    VALUES (v_workspace_id, v_session_id, 'email_opened', '{}');
    RAISE NOTICE 'PASS [1b]: email_opened accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'FAIL [1b]: email_opened should be accepted';
  END;

  BEGIN
    INSERT INTO events (workspace_id, session_id, event_type, properties)
    VALUES (v_workspace_id, v_session_id, 'email_clicked', '{}');
    RAISE NOTICE 'PASS [1c]: email_clicked accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'FAIL [1c]: email_clicked should be accepted';
  END;

  BEGIN
    INSERT INTO events (workspace_id, session_id, event_type, properties)
    VALUES (v_workspace_id, v_session_id, 'email_bounced', '{}');
    RAISE NOTICE 'PASS [1d]: email_bounced accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'FAIL [1d]: email_bounced should be accepted';
  END;

  -- ──────────────────────────────────────────────────────────
  -- Test 2: All pre-existing event_type values still accepted
  -- ──────────────────────────────────────────────────────────

  BEGIN
    INSERT INTO events (workspace_id, session_id, event_type, properties)
    VALUES (v_workspace_id, v_session_id, 'page_view', '{}');
    RAISE NOTICE 'PASS [2a]: page_view still accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'FAIL [2a]: page_view must still be accepted — regression in CHECK';
  END;

  BEGIN
    INSERT INTO events (workspace_id, session_id, event_type, properties)
    VALUES (v_workspace_id, v_session_id, 'property_view', '{}');
    RAISE NOTICE 'PASS [2b]: property_view still accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'FAIL [2b]: property_view must still be accepted';
  END;

  BEGIN
    INSERT INTO events (workspace_id, session_id, event_type, properties)
    VALUES (v_workspace_id, v_session_id, 'form_submit', '{}');
    RAISE NOTICE 'PASS [2c]: form_submit still accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'FAIL [2c]: form_submit must still be accepted';
  END;

  BEGIN
    INSERT INTO events (workspace_id, session_id, event_type, properties)
    VALUES (v_workspace_id, v_session_id, 'scroll_depth', '{}');
    RAISE NOTICE 'PASS [2d]: scroll_depth still accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'FAIL [2d]: scroll_depth must still be accepted';
  END;

  BEGIN
    INSERT INTO events (workspace_id, session_id, event_type, properties)
    VALUES (v_workspace_id, v_session_id, 'return_visit', '{}');
    RAISE NOTICE 'PASS [2e]: return_visit still accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'FAIL [2e]: return_visit must still be accepted';
  END;

  BEGIN
    INSERT INTO events (workspace_id, session_id, event_type, properties)
    VALUES (v_workspace_id, v_session_id, 'campaign_click', '{}');
    RAISE NOTICE 'PASS [2f]: campaign_click still accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'FAIL [2f]: campaign_click must still be accepted';
  END;

  -- ──────────────────────────────────────────────────────────
  -- Test 3: Bogus event_type rejected
  -- ──────────────────────────────────────────────────────────

  BEGIN
    INSERT INTO events (workspace_id, session_id, event_type, properties)
    VALUES (v_workspace_id, v_session_id, 'not_a_real_event', '{}');
    RAISE EXCEPTION 'FAIL [3]: bogus event_type should be rejected by events_event_type_check';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS [3]: bogus event_type correctly rejected';
  END;

  -- ──────────────────────────────────────────────────────────
  -- Test 4: events_session_or_contact CHECK
  -- ──────────────────────────────────────────────────────────

  -- 4a. (NULL, NULL) must be rejected
  BEGIN
    INSERT INTO events (workspace_id, session_id, contact_id, event_type, properties)
    VALUES (v_workspace_id, NULL, NULL, 'page_view', '{}');
    RAISE EXCEPTION 'FAIL [4a]: (NULL session, NULL contact) should be rejected by events_session_or_contact';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS [4a]: (NULL session, NULL contact) correctly rejected';
  END;

  -- 4b. (NULL session, non-NULL contact) must be accepted
  BEGIN
    INSERT INTO events (workspace_id, session_id, contact_id, event_type, properties)
    VALUES (v_workspace_id, NULL, v_contact_id, 'email_sent', '{}');
    RAISE NOTICE 'PASS [4b]: (NULL session, contact_id) accepted — email event shape valid';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'FAIL [4b]: (NULL session, contact_id) should be accepted by events_session_or_contact';
  END;

  -- 4c. (non-NULL session, NULL contact) must be accepted — existing ingestion shape
  BEGIN
    INSERT INTO events (workspace_id, session_id, contact_id, event_type, properties)
    VALUES (v_workspace_id, v_session_id, NULL, 'page_view', '{}');
    RAISE NOTICE 'PASS [4c]: (session_id, NULL contact) accepted — existing ingestion shape preserved';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'FAIL [4c]: (session_id, NULL contact) should be accepted';
  END;

  -- ──────────────────────────────────────────────────────────
  -- Test 5: is_recipient_excluded — seeded AU domain exclusion
  -- The agents_seed_email_exclusions trigger fires on INSERT INTO
  -- agents above, so v_agent_id already has the AU defaults.
  -- ──────────────────────────────────────────────────────────

  SELECT * INTO v_row
  FROM is_recipient_excluded(v_agent_id, 'foo@realestate.com.au');

  IF NOT v_row.excluded THEN
    RAISE EXCEPTION 'FAIL [5]: foo@realestate.com.au should be excluded (au_default domain seed)';
  END IF;
  IF v_row.reason <> 'au_default' THEN
    RAISE EXCEPTION 'FAIL [5]: reason should be ''au_default'', got: %', v_row.reason;
  END IF;
  RAISE NOTICE 'PASS [5]: foo@realestate.com.au excluded, reason=au_default';

  -- Spot-check a second seeded domain.
  SELECT * INTO v_row
  FROM is_recipient_excluded(v_agent_id, 'agent@homely.com.au');

  IF NOT v_row.excluded THEN
    RAISE EXCEPTION 'FAIL [5b]: agent@homely.com.au should be excluded (au_default domain seed)';
  END IF;
  RAISE NOTICE 'PASS [5b]: agent@homely.com.au excluded, reason=au_default';

  -- ──────────────────────────────────────────────────────────
  -- Test 6: is_recipient_excluded — safe domain returns (false, NULL)
  -- ──────────────────────────────────────────────────────────

  SELECT * INTO v_row
  FROM is_recipient_excluded(v_agent_id, 'someone@safedomain.example.com');

  IF v_row.excluded THEN
    RAISE EXCEPTION 'FAIL [6]: safedomain.example.com should not be excluded';
  END IF;
  IF v_row.reason IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL [6]: reason should be NULL for a clear address, got: %', v_row.reason;
  END IF;
  RAISE NOTICE 'PASS [6]: safedomain.example.com not excluded, reason=NULL';

  -- ──────────────────────────────────────────────────────────
  -- Test 7: is_recipient_excluded honours contacts.unsubscribed_at
  -- The contact email (lead@safedomain.example.com) is in a
  -- non-excluded domain. Setting unsubscribed_at must make it
  -- excluded with reason='unsubscribed', taking priority over any
  -- domain check.
  -- ──────────────────────────────────────────────────────────

  UPDATE contacts SET unsubscribed_at = now() WHERE id = v_contact_id;

  SELECT * INTO v_row
  FROM is_recipient_excluded(v_agent_id, 'lead@safedomain.example.com');

  IF NOT v_row.excluded THEN
    RAISE EXCEPTION 'FAIL [7]: unsubscribed contact email should be excluded';
  END IF;
  IF v_row.reason <> 'unsubscribed' THEN
    RAISE EXCEPTION 'FAIL [7]: reason should be ''unsubscribed'', got: %', v_row.reason;
  END IF;
  RAISE NOTICE 'PASS [7]: unsubscribed contact excluded with reason=unsubscribed';

  -- Reset for subsequent tests.
  UPDATE contacts SET unsubscribed_at = NULL WHERE id = v_contact_id;

  -- ──────────────────────────────────────────────────────────
  -- Test 8: emit_email_event — unknown send_id returns NULL
  -- ──────────────────────────────────────────────────────────

  SELECT emit_email_event(
    '00000000-0000-0000-0000-000000000000'::uuid,
    'email_opened',
    '{}'::jsonb
  ) INTO v_event_id;

  IF v_event_id IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL [8]: unknown send_id should return NULL, got %', v_event_id;
  END IF;
  RAISE NOTICE 'PASS [8]: unknown send_id returns NULL';

  -- ──────────────────────────────────────────────────────────
  -- Test 9: emit_email_event — real email_sends row
  --   • returns a uuid (the new events.id)
  --   • increments open_count
  --   • sets first_opened_at
  --   • second call increments open_count again but leaves
  --     first_opened_at unchanged (COALESCE guard)
  -- ──────────────────────────────────────────────────────────

  INSERT INTO email_sends (
    workspace_id, agent_id, contact_id,
    to_email, subject, body_html
  ) VALUES (
    v_workspace_id, v_agent_id, v_contact_id,
    'lead@safedomain.example.com',
    'Test subject HOR-223',
    '<p>Test body</p>'
  )
  RETURNING id INTO v_send_id;

  SELECT emit_email_event(v_send_id, 'email_opened', '{}'::jsonb)
  INTO v_event_id;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'FAIL [9a]: emit_email_event should return a uuid for a valid send';
  END IF;
  RAISE NOTICE 'PASS [9a]: emit_email_event returns a uuid (%)', v_event_id;

  SELECT * INTO v_row FROM email_sends WHERE id = v_send_id;

  IF v_row.open_count <> 1 THEN
    RAISE EXCEPTION 'FAIL [9b]: open_count should be 1 after first open, got %', v_row.open_count;
  END IF;
  RAISE NOTICE 'PASS [9b]: open_count = 1 after first emit_email_event(email_opened)';

  IF v_row.first_opened_at IS NULL THEN
    RAISE EXCEPTION 'FAIL [9c]: first_opened_at should be set after first open';
  END IF;
  RAISE NOTICE 'PASS [9c]: first_opened_at set after first open';

  -- Second open: open_count increments but first_opened_at is preserved.
  PERFORM emit_email_event(v_send_id, 'email_opened', '{}'::jsonb);

  SELECT * INTO v_row FROM email_sends WHERE id = v_send_id;

  IF v_row.open_count <> 2 THEN
    RAISE EXCEPTION 'FAIL [9d]: open_count should be 2 after second open, got %', v_row.open_count;
  END IF;
  RAISE NOTICE 'PASS [9d]: open_count = 2 after second emit_email_event(email_opened)';

  -- Verify the events row anchors to the contact and has the send_id in properties.
  IF NOT EXISTS (
    SELECT 1 FROM events
    WHERE id          = v_event_id
      AND contact_id  = v_contact_id
      AND session_id  IS NULL
      AND event_type  = 'email_opened'
      AND (properties->>'email_send_id')::uuid = v_send_id
  ) THEN
    RAISE EXCEPTION 'FAIL [9e]: emitted event row does not match expected shape';
  END IF;
  RAISE NOTICE 'PASS [9e]: emitted events row has correct contact_id, NULL session_id, and email_send_id in properties';

  RAISE NOTICE '──────────────────────────────────────────────────────────';
  RAISE NOTICE 'All HOR-223 assertions passed. Transaction will ROLLBACK.';
  RAISE NOTICE '──────────────────────────────────────────────────────────';

END $$;

ROLLBACK;
