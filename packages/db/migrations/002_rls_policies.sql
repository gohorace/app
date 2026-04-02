-- ============================================================
-- Migration 002: Row Level Security Policies
-- ============================================================
-- All tenant-scoped tables are protected by org membership.
-- Tracking endpoints use the service role key (bypasses RLS).
-- ============================================================

-- Helper function: returns array of org IDs the current user belongs to.
-- Lives in public schema (auth schema is locked in Supabase).
CREATE OR REPLACE FUNCTION public.user_org_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ARRAY(
    SELECT org_id FROM org_members WHERE user_id = auth.uid()
  )
$$;

-- ============================================================
-- ORGS
-- ============================================================
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orgs_select" ON orgs
  FOR SELECT USING (id = ANY(public.user_org_ids()));

-- ============================================================
-- ORG MEMBERS
-- ============================================================
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_select" ON org_members
  FOR SELECT USING (org_id = ANY(public.user_org_ids()));

-- ============================================================
-- ORG SETTINGS
-- ============================================================
ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_settings_select" ON org_settings
  FOR SELECT USING (org_id = ANY(public.user_org_ids()));

CREATE POLICY "org_settings_insert" ON org_settings
  FOR INSERT WITH CHECK (org_id = ANY(public.user_org_ids()));

CREATE POLICY "org_settings_update" ON org_settings
  FOR UPDATE USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

-- ============================================================
-- CONTACTS
-- ============================================================
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts_all" ON contacts
  USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

-- ============================================================
-- SESSIONS
-- ============================================================
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions_all" ON sessions
  USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

-- ============================================================
-- EVENTS
-- ============================================================
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events_all" ON events
  USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

-- ============================================================
-- SCORE HISTORY
-- ============================================================
ALTER TABLE score_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "score_history_all" ON score_history
  USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

-- ============================================================
-- CAMPAIGNS
-- ============================================================
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaigns_all" ON campaigns
  USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

-- ============================================================
-- CAMPAIGN TOKENS
-- ============================================================
ALTER TABLE campaign_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaign_tokens_all" ON campaign_tokens
  USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

-- ============================================================
-- CRM IMPORTS
-- ============================================================
ALTER TABLE crm_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_imports_all" ON crm_imports
  USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

-- ============================================================
-- NOTIFICATION LOG
-- ============================================================
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_log_all" ON notification_log
  USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));
