-- ============================================================
-- HOR-50  Onboarding state persistence
-- Tracks where each agent is in the onboarding flow so that
--   • magic-link clicks land on the correct resume step
--   • returning visits to /onboarding skip ahead
-- ============================================================

ALTER TABLE agents
  ADD COLUMN last_completed_step text
    CHECK (last_completed_step IN ('profile', 'script', 'contacts', 'notify', 'done'));

COMMENT ON COLUMN agents.last_completed_step IS
  'Onboarding progress marker. NULL = not yet started. Advanced as the agent completes each step. Used by /onboarding to land on the right step.';

-- ============================================================
-- HOR-47  Workspace+agent creation now captures phone and seeds
-- last_completed_step = 'profile' (profile data was captured at
-- signup, before the magic-link click).
-- ============================================================

CREATE OR REPLACE FUNCTION create_workspace_with_agent(
  p_user_id    uuid,
  p_name       text,
  p_slug       text,
  p_email      text,
  p_first_name text DEFAULT NULL,
  p_last_name  text DEFAULT NULL,
  p_phone      text DEFAULT NULL
)
RETURNS TABLE (workspace_id uuid, agent_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_workspace_id uuid;
  v_agent_id     uuid;
BEGIN
  INSERT INTO workspaces (name, slug)
  VALUES (p_name, p_slug)
  RETURNING id INTO v_workspace_id;

  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (v_workspace_id, p_user_id, 'owner');

  INSERT INTO workspace_settings (workspace_id)
  VALUES (v_workspace_id);

  INSERT INTO agents (workspace_id, user_id, email, first_name, last_name, phone, last_completed_step)
  VALUES (v_workspace_id, p_user_id, p_email, p_first_name, p_last_name, p_phone, 'profile')
  RETURNING id INTO v_agent_id;

  INSERT INTO agent_settings (agent_id)
  VALUES (v_agent_id);

  UPDATE workspaces
  SET default_agent_id = v_agent_id
  WHERE id = v_workspace_id;

  RETURN QUERY SELECT v_workspace_id, v_agent_id;
END;
$$;
