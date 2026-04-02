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
-- ============================================================
-- Migration 003: Scoring Functions and Triggers
-- ============================================================

-- ============================================================
-- TRIGGER: Back-fill events with contact_id when session is
-- linked to a contact (identity resolution)
-- ============================================================

CREATE OR REPLACE FUNCTION backfill_events_contact_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- When session.contact_id transitions from NULL to a value,
  -- update all existing events for this session that lack a contact_id
  IF NEW.contact_id IS NOT NULL AND OLD.contact_id IS NULL THEN
    UPDATE events
    SET contact_id = NEW.contact_id
    WHERE session_id = NEW.id
      AND contact_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER session_contact_backfill
  AFTER UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION backfill_events_contact_id();

-- ============================================================
-- TRIGGER: Update contacts.last_seen_at when new events arrive
-- ============================================================

CREATE OR REPLACE FUNCTION update_contact_last_seen()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL THEN
    UPDATE contacts
    SET last_seen_at = GREATEST(last_seen_at, NEW.occurred_at)
    WHERE id = NEW.contact_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_update_contact_last_seen
  AFTER INSERT ON events
  FOR EACH ROW
  EXECUTE FUNCTION update_contact_last_seen();

-- ============================================================
-- TRIGGER: Update org_settings.updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER org_settings_updated_at
  BEFORE UPDATE ON org_settings
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- FUNCTION: Create org with settings and member in one call
-- (used by signup flow via service role)
-- ============================================================

CREATE OR REPLACE FUNCTION create_org_with_owner(
  p_user_id  uuid,
  p_name     text,
  p_slug     text,
  p_email    text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  INSERT INTO orgs (name, slug)
  VALUES (p_name, p_slug)
  RETURNING id INTO v_org_id;

  INSERT INTO org_members (org_id, user_id, role)
  VALUES (v_org_id, p_user_id, 'owner');

  INSERT INTO org_settings (org_id, agent_email)
  VALUES (v_org_id, p_email);

  RETURN v_org_id;
END;
$$;

-- ============================================================
-- FUNCTION: Get weekly briefing data for an org
-- ============================================================

CREATE OR REPLACE FUNCTION get_weekly_briefing_data(p_org_id uuid)
RETURNS TABLE (
  contact_id    uuid,
  first_name    text,
  last_name     text,
  email         text,
  score         int,
  score_change  bigint,
  event_count   bigint,
  last_seen_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id AS contact_id,
    c.first_name,
    c.last_name,
    c.email,
    c.score,
    COALESCE(SUM(sh.delta), 0) AS score_change,
    COUNT(DISTINCT e.id) AS event_count,
    c.last_seen_at
  FROM contacts c
  JOIN events e
    ON e.contact_id = c.id
    AND e.occurred_at > now() - INTERVAL '7 days'
  LEFT JOIN score_history sh
    ON sh.contact_id = c.id
    AND sh.occurred_at > now() - INTERVAL '7 days'
  WHERE c.org_id = p_org_id
  GROUP BY c.id
  ORDER BY score_change DESC
  LIMIT 10;
$$;
-- ============================================================
-- Migration 004: Campaign Token Helpers
-- ============================================================

-- ============================================================
-- FUNCTION: Resolve a campaign token during tracking ingestion
-- Returns the contact_id associated with the token, or NULL.
-- Also records clicked_at on first use.
-- (Called by the tracking endpoint via service role)
-- ============================================================

CREATE OR REPLACE FUNCTION resolve_campaign_token(
  p_org_id uuid,
  p_token  text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_id uuid;
BEGIN
  UPDATE campaign_tokens
  SET clicked_at = COALESCE(clicked_at, now())
  WHERE token = p_token
    AND org_id = p_org_id
  RETURNING contact_id INTO v_contact_id;

  RETURN v_contact_id;
END;
$$;

-- ============================================================
-- FUNCTION: Generate campaign tokens for multiple contacts
-- Returns the number of tokens created.
-- ============================================================

CREATE OR REPLACE FUNCTION generate_campaign_tokens(
  p_org_id      uuid,
  p_campaign_id uuid,
  p_contact_ids uuid[]
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count  int := 0;
  v_cid    uuid;
  v_token  text;
BEGIN
  FOREACH v_cid IN ARRAY p_contact_ids LOOP
    -- Generate a 12-char base62-ish token using MD5 (server-side fallback)
    -- The application layer also does this; this function is for bulk ops
    v_token := substring(encode(gen_random_bytes(9), 'base64') FROM 1 FOR 12);
    v_token := replace(replace(replace(v_token, '+', 'A'), '/', 'B'), '=', 'C');

    INSERT INTO campaign_tokens (org_id, campaign_id, contact_id, token)
    VALUES (p_org_id, p_campaign_id, v_cid, v_token)
    ON CONFLICT (campaign_id, contact_id) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
