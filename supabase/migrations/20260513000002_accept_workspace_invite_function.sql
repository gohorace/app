-- ============================================================
-- HOR-100  accept_workspace_invite(invite_id, user_id)
--
-- Atomic redemption of a workspace_invites row. Called from
-- /auth/callback after a magic-link auth completes with `invite_id`
-- in the redirect URL.
--
-- In one transaction:
--   1. Lock the invite row.
--   2. Validate: not accepted, not revoked, not expired.
--   3. Email match: invited email == authenticated user's email
--      (case-insensitive). HARD reject otherwise.
--   4. Insert workspace_members with derived role:
--        invite.role='manager' → workspace_members.role='admin'
--        invite.role='agent'   → workspace_members.role='viewer'
--      ON CONFLICT DO NOTHING preserves any existing membership.
--   5. Upsert agents row. If pre-created with status='invited', flip
--      to 'active' + set role from invite. If already active, keep
--      existing role (don't downgrade — re-invite shouldn't demote).
--   6. Mark invite.accepted_at = now().
--
-- Returns the workspace_id + role so the caller can redirect the
-- user into the right workspace.
--
-- Errors (caller distinguishes by SQLSTATE):
--   P0001 invite_already_accepted | invite_revoked | invite_expired | email_mismatch
--   P0002 invite_not_found | user_not_found
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
  v_invite       record;
  v_user_email   text;
  v_member_role  text;
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

  -- 4. Derive workspace_members.role per HOR-65 reconciliation.
  v_member_role := CASE v_invite.role
    WHEN 'manager' THEN 'admin'
    WHEN 'agent'   THEN 'viewer'
    ELSE 'viewer'
  END;

  -- Insert membership. Existing membership is preserved as-is.
  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (v_invite.workspace_id, p_user_id, v_member_role)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  -- 5. Upsert agents row.
  --    For a pre-created 'invited' row → flip to active + apply invite role.
  --    For an already-active row → keep existing role (no downgrade).
  INSERT INTO agents (workspace_id, user_id, role, status, joined_at)
  VALUES (v_invite.workspace_id, p_user_id, v_invite.role, 'active', now())
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET role = CASE
                  WHEN agents.status = 'invited' THEN EXCLUDED.role
                  ELSE agents.role
                END,
        status     = 'active',
        joined_at  = COALESCE(agents.joined_at, EXCLUDED.joined_at);

  -- 6. Mark accepted.
  UPDATE workspace_invites
     SET accepted_at = now()
   WHERE id = p_invite_id;

  RETURN QUERY SELECT v_invite.workspace_id, v_invite.role;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_workspace_invite(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invite(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.accept_workspace_invite(uuid, uuid) IS
  'HOR-100: atomic redemption of a workspace_invites row. Validates state + email match, inserts workspace_members + agents in one transaction, marks invite accepted. Returns (workspace_id, role). Raises P0001 for state/match errors, P0002 for not-found errors.';

COMMIT;
