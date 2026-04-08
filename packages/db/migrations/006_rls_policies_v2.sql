-- ============================================================
-- Migration 006: Row Level Security Policies v2
-- Replaces org-based RLS from migration 002 with workspace-
-- and agent-scoped policies.
--
-- Tracking ingestion endpoints use the service role key and
-- bypass RLS entirely; these policies protect dashboard reads.
-- ============================================================

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Returns array of workspace IDs the current user belongs to.
CREATE OR REPLACE FUNCTION public.user_workspace_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ARRAY(SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
$$;

-- Returns array of agent IDs owned by the current user.
CREATE OR REPLACE FUNCTION public.user_agent_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ARRAY(SELECT id FROM agents WHERE user_id = auth.uid())
$$;

-- ============================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================

ALTER TABLE workspaces         ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents             ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_map       ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_history      ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_tokens    ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_imports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log   ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- WORKSPACE-SCOPED POLICIES
-- ============================================================

-- workspaces: members can read their own workspaces
CREATE POLICY "workspaces_select" ON workspaces
  FOR SELECT USING (id = ANY(public.user_workspace_ids()));

-- workspace_members: members can see membership rows for their workspaces
CREATE POLICY "workspace_members_select" ON workspace_members
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

-- workspace_settings: members can read and write their workspace settings
CREATE POLICY "workspace_settings_select" ON workspace_settings
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

CREATE POLICY "workspace_settings_insert" ON workspace_settings
  FOR INSERT WITH CHECK (workspace_id = ANY(public.user_workspace_ids()));

CREATE POLICY "workspace_settings_update" ON workspace_settings
  FOR UPDATE
  USING     (workspace_id = ANY(public.user_workspace_ids()))
  WITH CHECK (workspace_id = ANY(public.user_workspace_ids()));

-- sessions: workspace members can read (service role writes during ingestion)
CREATE POLICY "sessions_select" ON sessions
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

-- events: workspace members can read (service role writes during ingestion)
CREATE POLICY "events_select" ON events
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

-- identity_map: workspace members can read; agents can insert their own rows
CREATE POLICY "identity_map_select" ON identity_map
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

CREATE POLICY "identity_map_agent_write" ON identity_map
  FOR INSERT WITH CHECK (agent_id = ANY(public.user_agent_ids()));

-- ============================================================
-- AGENT POLICIES
-- Agents can see their own record plus all agents in shared workspaces.
-- ============================================================

CREATE POLICY "agents_select_own" ON agents
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "agents_select_workspace" ON agents
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

CREATE POLICY "agents_update_own" ON agents
  FOR UPDATE
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- AGENT-SCOPED POLICIES
-- Full access to rows owned by the current user's agent(s).
-- ============================================================

-- agent_settings
CREATE POLICY "agent_settings_all" ON agent_settings
  USING     (agent_id = ANY(public.user_agent_ids()))
  WITH CHECK (agent_id = ANY(public.user_agent_ids()));

-- contacts
CREATE POLICY "contacts_all" ON contacts
  USING     (agent_id = ANY(public.user_agent_ids()))
  WITH CHECK (agent_id = ANY(public.user_agent_ids()));

-- score_history
CREATE POLICY "score_history_all" ON score_history
  USING     (agent_id = ANY(public.user_agent_ids()))
  WITH CHECK (agent_id = ANY(public.user_agent_ids()));

-- campaigns
CREATE POLICY "campaigns_all" ON campaigns
  USING     (agent_id = ANY(public.user_agent_ids()))
  WITH CHECK (agent_id = ANY(public.user_agent_ids()));

-- campaign_tokens
CREATE POLICY "campaign_tokens_all" ON campaign_tokens
  USING     (agent_id = ANY(public.user_agent_ids()))
  WITH CHECK (agent_id = ANY(public.user_agent_ids()));

-- crm_imports
CREATE POLICY "crm_imports_all" ON crm_imports
  USING     (agent_id = ANY(public.user_agent_ids()))
  WITH CHECK (agent_id = ANY(public.user_agent_ids()));

-- notification_log
CREATE POLICY "notification_log_all" ON notification_log
  USING     (agent_id = ANY(public.user_agent_ids()))
  WITH CHECK (agent_id = ANY(public.user_agent_ids()));
