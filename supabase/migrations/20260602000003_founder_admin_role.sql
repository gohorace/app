-- ============================================================
-- HOR-377  Founder admin-role repair  (Phase 3 of the Access Control epic)
--
-- The canonical Role axis is agents.role (HOR-376). But create_workspace_with_agent
-- (migration 20260510000001) inserts the founder's agents row WITHOUT a role, so it
-- defaults to 'agent' — while their workspace_members.role is 'owner'. The HOR-376
-- backfill only fixed rows that existed at that migration's runtime, so every
-- workspace created since has a founder mis-classified as a plain Agent. With the
-- canonical layer now live (admin-guard, user_admin_workspace_ids), those founders
-- are wrongly denied admin-only surfaces.
--
-- This migration:
--   1. Reconciles agents.role from workspace_members.role for any drift
--      (owner→admin, admin→manager, viewer→agent). Consistent with the invite
--      redemption mapping, so it only moves drifted founders; correctly-set rows
--      are unchanged.
--   2. Fixes create_workspace_with_agent to set the founder's agents.role='admin'
--      so new workspaces are correct at the source.
--
-- ⚠️ Migration drift: apply via Studio SQL editor + manual INSERT into
-- supabase_migrations.schema_migrations. Do NOT `supabase db push` (HOR-131).
-- ============================================================

BEGIN;

-- 1. Reconcile drifted roles (idempotent for already-correct rows).
UPDATE agents a
SET role = CASE wm.role
  WHEN 'owner'  THEN 'admin'
  WHEN 'admin'  THEN 'manager'
  WHEN 'viewer' THEN 'agent'
  ELSE a.role
END
FROM workspace_members wm
WHERE wm.user_id = a.user_id
  AND wm.workspace_id = a.workspace_id
  AND a.role <> CASE wm.role
    WHEN 'owner'  THEN 'admin'
    WHEN 'admin'  THEN 'manager'
    WHEN 'viewer' THEN 'agent'
    ELSE a.role
  END;

-- 2. Fix the source: founders are Admins.
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

  -- HOR-377: the founder is the workspace Admin on the canonical Role axis.
  INSERT INTO agents (workspace_id, user_id, email, first_name, last_name, phone, role, last_completed_step)
  VALUES (v_workspace_id, p_user_id, p_email, p_first_name, p_last_name, p_phone, 'admin', 'profile')
  RETURNING id INTO v_agent_id;

  INSERT INTO agent_settings (agent_id)
  VALUES (v_agent_id);

  UPDATE workspaces
  SET default_agent_id = v_agent_id
  WHERE id = v_workspace_id;

  RETURN QUERY SELECT v_workspace_id, v_agent_id;
END;
$$;

COMMIT;
