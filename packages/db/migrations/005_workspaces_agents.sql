-- ============================================================
-- Migration 005: Workspaces & Agents Schema
-- Replaces the org-centric schema from migrations 001–004.
-- Old tables are dropped and recreated with the new model:
--   - workspaces  (replaces orgs)
--   - agents      (new: one agent record per user per workspace)
--   - identity_map (new: explicit anon→contact stitching table)
-- ============================================================

-- ============================================================
-- DROP LEGACY OBJECTS (reverse dependency order)
-- ============================================================

DROP TABLE IF EXISTS notification_log  CASCADE;
DROP TABLE IF EXISTS crm_imports       CASCADE;
DROP TABLE IF EXISTS campaign_tokens   CASCADE;
DROP TABLE IF EXISTS campaigns         CASCADE;
DROP TABLE IF EXISTS score_history     CASCADE;
DROP TABLE IF EXISTS contacts          CASCADE;
DROP TABLE IF EXISTS events            CASCADE;
DROP TABLE IF EXISTS sessions          CASCADE;
DROP TABLE IF EXISTS org_settings      CASCADE;
DROP TABLE IF EXISTS org_members       CASCADE;
DROP TABLE IF EXISTS orgs              CASCADE;

DROP FUNCTION IF EXISTS create_org_with_owner(uuid, text, text, text);
DROP FUNCTION IF EXISTS get_weekly_briefing_data(uuid);
DROP FUNCTION IF EXISTS resolve_campaign_token(uuid, text);
DROP FUNCTION IF EXISTS generate_campaign_tokens(uuid, uuid, uuid[]);
DROP FUNCTION IF EXISTS user_org_ids();
DROP FUNCTION IF EXISTS set_updated_at();

-- ============================================================
-- WORKSPACES
-- (default_agent_id FK added after agents table exists)
-- ============================================================

CREATE TABLE workspaces (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  slug             text UNIQUE NOT NULL,
  snippet_key      uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  plan             text NOT NULL DEFAULT 'trial',
  default_agent_id uuid, -- FK to agents(id) added below
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- WORKSPACE MEMBERS
-- ============================================================

CREATE TABLE workspace_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'viewer')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX workspace_members_user_id_idx ON workspace_members(user_id);

-- ============================================================
-- WORKSPACE SETTINGS
-- ============================================================

CREATE TABLE workspace_settings (
  workspace_id    uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  snippet_domains text[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- AGENTS
-- One record per user per workspace; holds agent-level identity.
-- ============================================================

CREATE TABLE agents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name   text,
  last_name    text,
  email        text,
  phone        text,
  rex_agent_id text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX agents_workspace_id_idx ON agents(workspace_id);
CREATE INDEX agents_user_id_idx      ON agents(user_id);

-- Deferred FK: workspaces.default_agent_id → agents(id)
ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_default_agent_id_fkey
  FOREIGN KEY (default_agent_id) REFERENCES agents(id) ON DELETE SET NULL;

-- ============================================================
-- AGENT SETTINGS
-- Per-agent SMS, scoring, and briefing preferences.
-- ============================================================

CREATE TABLE agent_settings (
  agent_id            uuid PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  sms_enabled         boolean NOT NULL DEFAULT false,
  sms_threshold_score int NOT NULL DEFAULT 50,
  agent_phone         text,
  agent_email         text,
  scoring_config      jsonb NOT NULL DEFAULT '{}',
  weekly_briefing_day smallint NOT NULL DEFAULT 1
                        CHECK (weekly_briefing_day BETWEEN 0 AND 6),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- SESSIONS
-- Workspace-scoped; no contact_id (identity resolved via identity_map).
-- ============================================================

CREATE TABLE sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  anonymous_id   text NOT NULL,
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
  UNIQUE(workspace_id, anonymous_id)
);

CREATE INDEX sessions_campaign_token_idx      ON sessions(campaign_token) WHERE campaign_token IS NOT NULL;
CREATE INDEX sessions_workspace_last_seen_idx ON sessions(workspace_id, last_seen_at DESC);

-- ============================================================
-- EVENTS
-- Workspace-scoped; no contact_id (join via identity_map).
-- ============================================================

CREATE TABLE events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id   uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_type   text NOT NULL CHECK (event_type IN (
    'page_view', 'property_view', 'form_submit',
    'scroll_depth', 'return_visit', 'campaign_click'
  )),
  properties   jsonb NOT NULL DEFAULT '{}',
  score_delta  int NOT NULL DEFAULT 0,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_session_idx                ON events(session_id);
CREATE INDEX events_workspace_occurred_at_idx  ON events(workspace_id, occurred_at DESC);

-- ============================================================
-- CONTACTS
-- Agent-scoped; one record per lead per agent.
-- ============================================================

CREATE TABLE contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  email           text,
  phone           text,
  first_name      text,
  last_name       text,
  score           int NOT NULL DEFAULT 0,
  crm_source      text CHECK (crm_source IN ('rex', 'agentbox', 'manual')),
  crm_external_id text,
  identified_at   timestamptz,
  last_seen_at    timestamptz,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id, email)
);

CREATE INDEX contacts_agent_score_idx     ON contacts(agent_id, score DESC);
CREATE INDEX contacts_agent_last_seen_idx ON contacts(agent_id, last_seen_at DESC NULLS LAST);
CREATE INDEX contacts_agent_email_idx     ON contacts(agent_id, email);

-- ============================================================
-- IDENTITY MAP
-- Stitches anonymous_id → contact_id within a workspace/agent scope.
-- ============================================================

CREATE TABLE identity_map (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id      uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  anonymous_id  text NOT NULL,
  contact_id    uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  stitch_method text NOT NULL CHECK (stitch_method IN ('form', 'email_click', 'manual')),
  confidence    text NOT NULL DEFAULT 'high' CHECK (confidence IN ('high', 'medium', 'low')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, agent_id, anonymous_id)
);

CREATE INDEX identity_map_workspace_anon_idx ON identity_map(workspace_id, anonymous_id);
CREATE INDEX identity_map_contact_idx        ON identity_map(contact_id);
CREATE INDEX identity_map_agent_anon_idx     ON identity_map(agent_id, anonymous_id);

-- ============================================================
-- SCORE HISTORY
-- Agent-scoped audit trail for every score change.
-- ============================================================

CREATE TABLE score_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  delta        int NOT NULL,
  reason       text NOT NULL,
  event_id     uuid REFERENCES events(id) ON DELETE SET NULL,
  score_before int NOT NULL,
  score_after  int NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX score_history_contact_idx           ON score_history(contact_id, occurred_at DESC);
CREATE INDEX score_history_agent_occurred_at_idx ON score_history(agent_id, occurred_at DESC);

-- ============================================================
-- CAMPAIGNS
-- Agent-scoped email/outreach campaigns.
-- ============================================================

CREATE TABLE campaigns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX campaigns_agent_id_idx ON campaigns(agent_id);

-- ============================================================
-- CAMPAIGN TOKENS
-- Agent-scoped; one token per contact per campaign.
-- ============================================================

CREATE TABLE campaign_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  token       text UNIQUE NOT NULL,
  clicked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, contact_id)
);

CREATE INDEX campaign_tokens_token_idx      ON campaign_tokens(token);
CREATE INDEX campaign_tokens_contact_id_idx ON campaign_tokens(contact_id);

-- ============================================================
-- CRM IMPORTS
-- Agent-scoped import job tracking.
-- ============================================================

CREATE TABLE crm_imports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  source        text NOT NULL DEFAULT 'rex',
  filename      text,
  row_count     int,
  created_count int,
  matched_count int,
  skipped_count int,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX crm_imports_agent_id_idx ON crm_imports(agent_id, created_at DESC);

-- ============================================================
-- NOTIFICATION LOG
-- Agent-scoped; deduplicates SMS and email notifications.
-- ============================================================

CREATE TABLE notification_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  type       text NOT NULL CHECK (type IN (
    'sms_threshold', 'sms_form', 'sms_return', 'email_briefing'
  )),
  sent_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notification_log_dedup_idx
  ON notification_log(agent_id, contact_id, type, sent_at DESC);
