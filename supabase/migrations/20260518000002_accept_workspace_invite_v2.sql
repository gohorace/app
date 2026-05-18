-- ============================================================
-- HOR-203  accept_workspace_invite v2 — support-seat redemption
--
-- Replaces the v1 RPC from 20260513000002. New behaviour:
--
--   invite.role = 'manager' → unchanged
--     workspace_members.role = 'admin'
--     agents.role            = 'manager'
--     agents.seat_type       = 'agent'  (default)
--
--   invite.role = 'agent' → unchanged
--     workspace_members.role = 'viewer'
--     agents.role            = 'agent'
--     agents.seat_type       = 'agent'  (default)
--
--   invite.role = 'support' → NEW
--     workspace_members.role = 'viewer'  (existing read scope is enough)
--     agents.role            = 'agent'   (operational role unchanged)
--     agents.seat_type       = 'support' (the discriminator)
--     + auto-insert support_seat_assignments row binding the new
--       support seat to workspaces.default_agent_id (Pro path).
--       Office/Enterprise multi-assignment lights up with HOR-189.
--
-- Errors are unchanged (SQLSTATE P0001 / P0002 codes). Callers in
-- /auth/callback don't need updating beyond the role label widening.
--
-- ⚠️ Migration drift caveat: same as 20260518000001 — apply via Studio
-- SQL editor + manual INSERT into supabase_migrations.schema_migrations.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.accept_workspace_invite(
  p_invite_id uuid,
  p_user_id   uuid
)
RETURNS TABLE (workspace_id uuid, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite           record;
  v_user_email       text;
  v_member_role      text;
  v_agent_role       text;
  v_seat_type        text;
  v_new_agent_id     uuid;
  v_default_agent_id uuid;
BEGIN
  -- 1. Lock invite row.
  SELECT *
    INTO v_invite
    FROM workspace_invites
   WHERE id = p_invite_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- 2. State checks.
  IF v_invite.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'invite_already_accepted' USING ERRCODE = 'P0001';
  END IF;
  IF v_invite.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'invite_revoked' USING ERRCODE = 'P0001';
  END IF;
  IF v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'invite_expired' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Email match (hard).
  SELECT email
    INTO v_user_email
    FROM auth.users
   WHERE id = p_user_id;

  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF lower(v_user_email) <> lower(v_invite.email) THEN
    RAISE EXCEPTION 'email_mismatch' USING ERRCODE = 'P0001';
  END IF;

  -- 4. Derive (workspace_members.role, agents.role, agents.seat_type)
  --    per HOR-203 reconciliation.
  IF v_invite.role = 'manager' THEN
    v_member_role := 'admin';
    v_agent_role  := 'manager';
    v_seat_type   := 'agent';
  ELSIF v_invite.role = 'support' THEN
    v_member_role := 'viewer';
    v_agent_role  := 'agent';   -- operational role stays 'agent'
    v_seat_type   := 'support';
  ELSE  -- 'agent' (and any future fallthrough)
    v_member_role := 'viewer';
    v_agent_role  := 'agent';
    v_seat_type   := 'agent';
  END IF;

  -- Insert membership. Existing membership is preserved as-is.
  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (v_invite.workspace_id, p_user_id, v_member_role)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  -- 5. Upsert agents row.
  --    For a pre-created 'invited' row → flip to active + apply invite
  --    role and seat_type. For an already-active row → keep existing
  --    role/seat_type (no downgrade — re-invite shouldn't demote).
  INSERT INTO agents (workspace_id, user_id, role, seat_type, status, joined_at)
  VALUES (v_invite.workspace_id, p_user_id, v_agent_role, v_seat_type, 'active', now())
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET role      = CASE
                       WHEN agents.status = 'invited' THEN EXCLUDED.role
                       ELSE agents.role
                     END,
        seat_type = CASE
                       WHEN agents.status = 'invited' THEN EXCLUDED.seat_type
                       ELSE agents.seat_type
                     END,
        status    = 'active',
        joined_at = COALESCE(agents.joined_at, EXCLUDED.joined_at)
    RETURNING id INTO v_new_agent_id;

  -- 6. Support seats: bind to the workspace's default agent on Pro.
  --    Office/Enterprise multi-assignment lands with HOR-189.
  IF v_seat_type = 'support' THEN
    SELECT default_agent_id
      INTO v_default_agent_id
      FROM workspaces
     WHERE id = v_invite.workspace_id;

    IF v_default_agent_id IS NOT NULL
       AND v_default_agent_id <> v_new_agent_id
    THEN
      INSERT INTO support_seat_assignments
        (workspace_id, support_agent_id, assigned_agent_id)
      VALUES
        (v_invite.workspace_id, v_new_agent_id, v_default_agent_id)
      ON CONFLICT (support_agent_id, assigned_agent_id) DO NOTHING;
    END IF;
  END IF;

  -- 7. Mark accepted.
  UPDATE workspace_invites
     SET accepted_at = now()
   WHERE id = p_invite_id;

  RETURN QUERY SELECT v_invite.workspace_id, v_invite.role;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_workspace_invite(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invite(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.accept_workspace_invite(uuid, uuid) IS
  'HOR-203 v2: atomic redemption of a workspace_invites row. Validates state + email match, inserts workspace_members + agents in one transaction, marks invite accepted. Routes support invites to seat_type=support + binds them to workspaces.default_agent_id via support_seat_assignments on Pro. Returns (workspace_id, role). Raises P0001 for state/match errors, P0002 for not-found errors.';

COMMIT;
