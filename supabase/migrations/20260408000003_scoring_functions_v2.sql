-- ============================================================
-- Migration 007: Scoring Functions & Triggers v2
-- Replaces functions from migration 003.
--
-- Changes from v1:
--   - create_org_with_owner → create_workspace_with_agent
--     (returns both workspace_id and agent_id)
--   - get_weekly_briefing_data now takes p_agent_id and joins
--     events via identity_map (events no longer have contact_id)
--   - New: get_contact_events for the lead detail activity timeline
--   - Removed: backfill_events_contact_id trigger (events no
--     longer carry contact_id; identity_map is the join layer)
-- ============================================================

-- ============================================================
-- TRIGGER FUNCTION: updated_at maintenance
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER workspace_settings_updated_at
  BEFORE UPDATE ON workspace_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER agent_settings_updated_at
  BEFORE UPDATE ON agent_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- FUNCTION: Atomic workspace + agent creation
-- Called by the signup flow via service role.
-- Returns workspace_id and agent_id so the caller can cache both.
-- ============================================================

CREATE OR REPLACE FUNCTION create_workspace_with_agent(
  p_user_id    uuid,
  p_name       text,
  p_slug       text,
  p_email      text,
  p_first_name text DEFAULT NULL,
  p_last_name  text DEFAULT NULL
)
RETURNS TABLE (workspace_id uuid, agent_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_workspace_id uuid;
  v_agent_id     uuid;
BEGIN
  -- Create workspace
  INSERT INTO workspaces (name, slug)
  VALUES (p_name, p_slug)
  RETURNING id INTO v_workspace_id;

  -- Add owner membership
  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (v_workspace_id, p_user_id, 'owner');

  -- Initialise workspace settings row
  INSERT INTO workspace_settings (workspace_id)
  VALUES (v_workspace_id);

  -- Create agent record for this user
  INSERT INTO agents (workspace_id, user_id, email, first_name, last_name)
  VALUES (v_workspace_id, p_user_id, p_email, p_first_name, p_last_name)
  RETURNING id INTO v_agent_id;

  -- Initialise agent settings row
  INSERT INTO agent_settings (agent_id)
  VALUES (v_agent_id);

  -- Point workspace at its default agent
  UPDATE workspaces
  SET default_agent_id = v_agent_id
  WHERE id = v_workspace_id;

  RETURN QUERY SELECT v_workspace_id, v_agent_id;
END;
$$;

-- ============================================================
-- FUNCTION: Weekly briefing data for an agent
-- Returns top 10 contacts by score change in the past 7 days.
-- Events are resolved through identity_map (no contact_id on events).
-- ============================================================

CREATE OR REPLACE FUNCTION get_weekly_briefing_data(p_agent_id uuid)
RETURNS TABLE (
  contact_id   uuid,
  first_name   text,
  last_name    text,
  email        text,
  score        int,
  score_change bigint,
  event_count  bigint,
  last_seen_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    c.id                                         AS contact_id,
    c.first_name,
    c.last_name,
    c.email,
    c.score,
    COALESCE(SUM(sh.delta), 0)                   AS score_change,
    COUNT(DISTINCT e.id)                         AS event_count,
    c.last_seen_at
  FROM contacts c
  LEFT JOIN score_history sh
    ON  sh.contact_id  = c.id
    AND sh.agent_id    = p_agent_id
    AND sh.occurred_at > now() - INTERVAL '7 days'
  LEFT JOIN identity_map im
    ON  im.contact_id  = c.id
    AND im.agent_id    = p_agent_id
  LEFT JOIN sessions s
    ON  s.workspace_id = im.workspace_id
    AND s.anonymous_id = im.anonymous_id
  LEFT JOIN events e
    ON  e.session_id   = s.id
    AND e.occurred_at  > now() - INTERVAL '7 days'
  WHERE c.agent_id = p_agent_id
    AND (sh.delta IS NOT NULL OR e.id IS NOT NULL)
  GROUP BY c.id
  ORDER BY score_change DESC
  LIMIT 10;
$$;

-- ============================================================
-- FUNCTION: All events for a contact (activity timeline)
-- Joins events through identity_map → sessions.
-- ============================================================

CREATE OR REPLACE FUNCTION get_contact_events(p_contact_id uuid)
RETURNS TABLE (
  event_id     uuid,
  event_type   text,
  properties   jsonb,
  score_delta  int,
  occurred_at  timestamptz,
  anonymous_id text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    e.id           AS event_id,
    e.event_type,
    e.properties,
    e.score_delta,
    e.occurred_at,
    s.anonymous_id
  FROM identity_map im
  JOIN sessions s
    ON  s.workspace_id = im.workspace_id
    AND s.anonymous_id = im.anonymous_id
  JOIN events e
    ON  e.session_id = s.id
  WHERE im.contact_id = p_contact_id
  ORDER BY e.occurred_at DESC;
$$;
