-- ============================================================
-- Fix: invited agents resume onboarding at 'core_markets' (patch),
-- not back at the start.
--
-- The v2 RPC (20260518000002, HOR-203) rewrote accept_workspace_invite for
-- support seats and DROPPED the last_completed_step seeding that v1
-- (20260513000003) had. New invited agents got last_completed_step = NULL
-- → resumeStep(NULL) = 'script' / agentic resumeTurnId(NULL) = T0, i.e. the
-- very start of onboarding.
--
-- This v3 restores the seeding to 'script' (v1's original value). resumeStep()
-- returns NEXT_STEP[seed], and NEXT_STEP['script'] = 'core_markets', so the
-- invited agent lands on the core_markets (patch) step — the agency owner has
-- already installed the snippet ('script'), so the invitee resumes from patch.
-- (See apps/web/src/lib/onboarding/state.ts STEPS/NEXT_STEP and
-- apps/web/src/lib/onboarding/resume.ts — both map 'script' → the patch turn.)
--
-- Everything else (support-seat routing, role/seat derivation, error codes,
-- support_seat_assignments) is carried over verbatim from v2.
--
-- ⚠️ Migration drift: apply via the Studio SQL editor + a manual INSERT into
-- supabase_migrations.schema_migrations. Do NOT `supabase db push` (HOR-131).
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
  --    role and seat_type, and seed last_completed_step = 'script' so the
  --    wizard resumes at 'core_markets' (patch). For an already-active row →
  --    keep existing role/seat_type/onboarding state (no downgrade, no
  --    onboarding rewind on re-invite).
  INSERT INTO agents (workspace_id, user_id, role, seat_type, status, joined_at, last_completed_step)
  VALUES (v_invite.workspace_id, p_user_id, v_agent_role, v_seat_type, 'active', now(), 'script')
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
        joined_at = COALESCE(agents.joined_at, EXCLUDED.joined_at),
        last_completed_step = CASE
                       WHEN agents.status = 'invited' THEN 'script'
                       ELSE agents.last_completed_step
                     END
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
  'HOR-203 v3: atomic redemption of a workspace_invites row. Validates state + email match, inserts workspace_members + agents in one transaction, marks invite accepted. Routes support invites to seat_type=support + binds them to workspaces.default_agent_id via support_seat_assignments on Pro. Seeds agents.last_completed_step = ''script'' so invitees resume onboarding at the core_markets (patch) step. Returns (workspace_id, role). Raises P0001 for state/match errors, P0002 for not-found errors.';

COMMIT;
