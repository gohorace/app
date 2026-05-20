-- ============================================================
-- HOR-252 — notes table tests. Covers 20260520000002_notes_table.sql.
--
-- Run via Supabase Studio SQL editor (admin / service-role context).
-- Wrapped in BEGIN … ROLLBACK so it leaves no data behind. No pgTAP —
-- DO blocks with RAISE EXCEPTION on failure, RAISE NOTICE on pass
-- (mirrors email_send_v1.spec.sql).
--
-- Fixture columns audited against the CURRENT schema per the
-- migration-review-checklist memory: agents (workspace_id, user_id —
-- both NOT NULL-ish; user_id NOT NULL FK to auth.users), contacts
-- (agent_id, workspace_id, metadata jsonb), workspaces.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_user_id    uuid := gen_random_uuid();
  v_ws_id      uuid;
  v_agent_id   uuid;
  v_contact_id uuid;
  v_property_id uuid;
  v_note_id    uuid;
  v_count      int;
BEGIN
  -- Fixtures
  INSERT INTO auth.users (id, instance_id, aud, role, email)
    VALUES (v_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'notes-spec-' || v_user_id || '@example.com');
  INSERT INTO workspaces (name) VALUES ('Notes Spec WS') RETURNING id INTO v_ws_id;
  INSERT INTO agents (workspace_id, user_id, first_name, last_name, email)
    VALUES (v_ws_id, v_user_id, 'Spec', 'Agent', 'spec@example.com') RETURNING id INTO v_agent_id;
  INSERT INTO contacts (workspace_id, agent_id, source)
    VALUES (v_ws_id, v_agent_id, 'manual') RETURNING id INTO v_contact_id;
  INSERT INTO properties (workspace_id, street_name, suburb)
    VALUES (v_ws_id, 'Maple St', 'Paddington') RETURNING id INTO v_property_id;

  -- 1. A contact note inserts cleanly + carries mentions[].
  INSERT INTO notes (workspace_id, author_id, body, contact_id, mentions)
    VALUES (v_ws_id, v_agent_id, 'Hi @' || v_agent_id, v_contact_id, ARRAY[v_agent_id])
    RETURNING id INTO v_note_id;
  IF v_note_id IS NULL THEN RAISE EXCEPTION 'contact note insert failed'; END IF;

  -- 2. A property note inserts cleanly.
  INSERT INTO notes (workspace_id, author_id, body, property_id)
    VALUES (v_ws_id, v_agent_id, 'Property note', v_property_id);

  -- 3. CHECK: both subjects set must FAIL.
  BEGIN
    INSERT INTO notes (workspace_id, author_id, body, contact_id, property_id)
      VALUES (v_ws_id, v_agent_id, 'bad', v_contact_id, v_property_id);
    RAISE EXCEPTION 'CHECK failed: both contact_id + property_id were accepted';
  EXCEPTION WHEN check_violation THEN
    NULL; -- expected
  END;

  -- 4. CHECK: neither subject set must FAIL.
  BEGIN
    INSERT INTO notes (workspace_id, author_id, body) VALUES (v_ws_id, v_agent_id, 'bad');
    RAISE EXCEPTION 'CHECK failed: a note with no subject was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL; -- expected
  END;

  -- 5. Defaults: resolved=false, mentions defaults to empty when omitted.
  SELECT count(*) INTO v_count FROM notes
    WHERE property_id = v_property_id AND resolved = false AND mentions = '{}';
  IF v_count <> 1 THEN RAISE EXCEPTION 'defaults wrong (resolved/mentions): got %', v_count; END IF;

  RAISE NOTICE 'notes.spec: all assertions passed';
END $$;

ROLLBACK;
