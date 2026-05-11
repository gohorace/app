-- ============================================================
-- Invitees land at onboarding step 3 (contacts) after redemption.
--
-- The wizard's 4 rail steps are: profile → script → contacts → notify.
-- A workspace owner has already installed the snippet (step 2), so an
-- invited agent should resume at step 3. The wizard reads
-- `agents.last_completed_step`; pre-seeding it to 'script' makes
-- `resumeStep()` return 'contacts'.
--
-- Updates accept_workspace_invite to set last_completed_step on the
-- upserted agents row:
--   • new agent row: insert with last_completed_step = 'script'
--   • pre-created 'invited' agent (status='invited'): advance to
--     'script' on flip to active
--   • already-active agent: leave their last_completed_step alone
--     — they may have progressed past 'script' already
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
  --    For a pre-created 'invited' row → flip to active + apply invite role
  --      and advance last_completed_step to 'script'.
  --    For an already-active row → keep existing role and onboarding state
  --      (no downgrade on re-invite).
  --    For a brand-new row → last_completed_step = 'script' so the wizard
  --      resumes at 'contacts' (step 3 of 4).
  INSERT INTO agents (workspace_id, user_id, role, status, joined_at, last_completed_step)
  VALUES (v_invite.workspace_id, p_user_id, v_invite.role, 'active', now(), 'script')
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET role                = CASE
                                WHEN agents.status = 'invited' THEN EXCLUDED.role
                                ELSE agents.role
                              END,
        status              = 'active',
        joined_at           = COALESCE(agents.joined_at, EXCLUDED.joined_at),
        last_completed_step = CASE
                                WHEN agents.status = 'invited' THEN 'script'
                                ELSE agents.last_completed_step
                              END;

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
  'HOR-100 + follow-up: atomic redemption. Pre-seeds agents.last_completed_step = ''script'' so invitees resume the onboarding wizard at step 3 (contacts). Returns (workspace_id, role).';

COMMIT;
