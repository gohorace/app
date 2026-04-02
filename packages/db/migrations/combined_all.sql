-- ============================================================
-- Migration 001: Initial Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS orgs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE NOT NULL,
  plan       text NOT NULL DEFAULT 'trial',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);

CREATE INDEX IF NOT EXISTS org_members_user_id_idx ON org_members(user_id);

CREATE TABLE IF NOT EXISTS org_settings (
  org_id               uuid PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  sms_enabled          boolean NOT NULL DEFAULT false,
  sms_threshold_score  int NOT NULL DEFAULT 50,
  agent_phone          text,
  agent_email          text,
  scoring_config       jsonb NOT NULL DEFAULT '{}',
  weekly_briefing_day  smallint NOT NULL DEFAULT 1 CHECK (weekly_briefing_day BETWEEN 0 AND 6),
  snippet_domains      text[] NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email           text,
  phone           text,
  first_name      text,
  last_name       text,
  score           int NOT NULL DEFAULT 0,
  crm_source      text CHECK (crm_source IN ('rex', 'agentbox', 'manual', NULL)),
  crm_external_id text,
  identified_at   timestamptz,
  last_seen_at    timestamptz,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, email)
);

CREATE INDEX IF NOT EXISTS contacts_org_score_idx ON contacts(org_id, score DESC);
CREATE INDEX IF NOT EXISTS contacts_org_last_seen_idx ON contacts(org_id, last_seen_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS contacts_org_email_idx ON contacts(org_id, email);

CREATE TABLE IF NOT EXISTS sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  anonymous_id   text NOT NULL,
  contact_id     uuid REFERENCES contacts(id) ON DELETE SET NULL,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  campaign_token text,
  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  utm_content    text,
  referrer       text,
  ip_country     text,
  user_agent     text,
  UNIQUE(org_id, anonymous_id)
);

CREATE INDEX IF NOT EXISTS sessions_contact_id_idx ON sessions(contact_id);
CREATE INDEX IF NOT EXISTS sessions_campaign_token_idx ON sessions(campaign_token) WHERE campaign_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS sessions_org_last_seen_idx ON sessions(org_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  session_id  uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  contact_id  uuid REFERENCES contacts(id) ON DELETE SET NULL,
  event_type  text NOT NULL CHECK (event_type IN (
    'page_view', 'property_view', 'form_submit',
    'scroll_depth', 'return_visit', 'campaign_click'
  )),
  properties  jsonb NOT NULL DEFAULT '{}',
  score_delta int NOT NULL DEFAULT 0,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_org_contact_idx ON events(org_id, contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS events_session_idx ON events(session_id);
CREATE INDEX IF NOT EXISTS events_org_occurred_at_idx ON events(org_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS events_contact_occurred_at_idx ON events(contact_id, occurred_at DESC) WHERE contact_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS score_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  delta        int NOT NULL,
  reason       text NOT NULL,
  event_id     uuid REFERENCES events(id) ON DELETE SET NULL,
  score_before int NOT NULL,
  score_after  int NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS score_history_contact_idx ON score_history(contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS score_history_org_occurred_at_idx ON score_history(org_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS campaigns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaigns_org_id_idx ON campaigns(org_id);

CREATE TABLE IF NOT EXISTS campaign_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  token       text UNIQUE NOT NULL,
  clicked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS campaign_tokens_token_idx ON campaign_tokens(token);
CREATE INDEX IF NOT EXISTS campaign_tokens_contact_id_idx ON campaign_tokens(contact_id);

CREATE TABLE IF NOT EXISTS crm_imports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  source         text NOT NULL DEFAULT 'rex',
  filename       text,
  row_count      int,
  created_count  int,
  matched_count  int,
  skipped_count  int,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_imports_org_id_idx ON crm_imports(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  type       text NOT NULL CHECK (type IN (
    'sms_threshold', 'sms_form', 'sms_return', 'email_briefing'
  )),
  sent_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_log_dedup_idx ON notification_log(org_id, contact_id, type, sent_at DESC);

-- ============================================================
-- Migration 002: Row Level Security Policies
-- ============================================================

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

ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

-- Drop and recreate policies to be idempotent
DROP POLICY IF EXISTS "orgs_select" ON orgs;
CREATE POLICY "orgs_select" ON orgs
  FOR SELECT USING (id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "org_members_select" ON org_members;
CREATE POLICY "org_members_select" ON org_members
  FOR SELECT USING (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "org_settings_select" ON org_settings;
CREATE POLICY "org_settings_select" ON org_settings
  FOR SELECT USING (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "org_settings_insert" ON org_settings;
CREATE POLICY "org_settings_insert" ON org_settings
  FOR INSERT WITH CHECK (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "org_settings_update" ON org_settings;
CREATE POLICY "org_settings_update" ON org_settings
  FOR UPDATE USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "contacts_all" ON contacts;
CREATE POLICY "contacts_all" ON contacts
  USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "sessions_all" ON sessions;
CREATE POLICY "sessions_all" ON sessions
  USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "events_all" ON events;
CREATE POLICY "events_all" ON events
  USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "score_history_all" ON score_history;
CREATE POLICY "score_history_all" ON score_history
  USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "campaigns_all" ON campaigns;
CREATE POLICY "campaigns_all" ON campaigns
  USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "campaign_tokens_all" ON campaign_tokens;
CREATE POLICY "campaign_tokens_all" ON campaign_tokens
  USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "crm_imports_all" ON crm_imports;
CREATE POLICY "crm_imports_all" ON crm_imports
  USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "notification_log_all" ON notification_log;
CREATE POLICY "notification_log_all" ON notification_log
  USING (org_id = ANY(public.user_org_ids()))
  WITH CHECK (org_id = ANY(public.user_org_ids()));

-- ============================================================
-- Migration 003: Scoring Functions and Triggers
-- ============================================================

CREATE OR REPLACE FUNCTION backfill_events_contact_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL AND OLD.contact_id IS NULL THEN
    UPDATE events
    SET contact_id = NEW.contact_id
    WHERE session_id = NEW.id
      AND contact_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS session_contact_backfill ON sessions;
CREATE TRIGGER session_contact_backfill
  AFTER UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION backfill_events_contact_id();

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

DROP TRIGGER IF EXISTS event_update_contact_last_seen ON events;
CREATE TRIGGER event_update_contact_last_seen
  AFTER INSERT ON events
  FOR EACH ROW
  EXECUTE FUNCTION update_contact_last_seen();

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_settings_updated_at ON org_settings;
CREATE TRIGGER org_settings_updated_at
  BEFORE UPDATE ON org_settings
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

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
