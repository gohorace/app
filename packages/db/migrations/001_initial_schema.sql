-- ============================================================
-- Migration 001: Initial Schema
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ORGANIZATIONS
-- ============================================================

CREATE TABLE orgs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE NOT NULL,
  plan       text NOT NULL DEFAULT 'trial',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- ORG MEMBERS
-- ============================================================

CREATE TABLE org_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);

CREATE INDEX org_members_user_id_idx ON org_members(user_id);

-- ============================================================
-- ORG SETTINGS
-- ============================================================

CREATE TABLE org_settings (
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

-- ============================================================
-- CONTACTS
-- ============================================================

CREATE TABLE contacts (
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

CREATE INDEX contacts_org_score_idx ON contacts(org_id, score DESC);
CREATE INDEX contacts_org_last_seen_idx ON contacts(org_id, last_seen_at DESC NULLS LAST);
CREATE INDEX contacts_org_email_idx ON contacts(org_id, email);

-- ============================================================
-- SESSIONS
-- ============================================================

CREATE TABLE sessions (
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

CREATE INDEX sessions_contact_id_idx ON sessions(contact_id);
CREATE INDEX sessions_campaign_token_idx ON sessions(campaign_token) WHERE campaign_token IS NOT NULL;
CREATE INDEX sessions_org_last_seen_idx ON sessions(org_id, last_seen_at DESC);

-- ============================================================
-- EVENTS
-- ============================================================

CREATE TABLE events (
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

CREATE INDEX events_org_contact_idx ON events(org_id, contact_id, occurred_at DESC);
CREATE INDEX events_session_idx ON events(session_id);
CREATE INDEX events_org_occurred_at_idx ON events(org_id, occurred_at DESC);
CREATE INDEX events_contact_occurred_at_idx ON events(contact_id, occurred_at DESC) WHERE contact_id IS NOT NULL;

-- ============================================================
-- SCORE HISTORY
-- ============================================================

CREATE TABLE score_history (
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

CREATE INDEX score_history_contact_idx ON score_history(contact_id, occurred_at DESC);
CREATE INDEX score_history_org_occurred_at_idx ON score_history(org_id, occurred_at DESC);

-- ============================================================
-- CAMPAIGNS
-- ============================================================

CREATE TABLE campaigns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX campaigns_org_id_idx ON campaigns(org_id);

-- ============================================================
-- CAMPAIGN TOKENS
-- ============================================================

CREATE TABLE campaign_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  token       text UNIQUE NOT NULL,
  clicked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, contact_id)
);

CREATE INDEX campaign_tokens_token_idx ON campaign_tokens(token);
CREATE INDEX campaign_tokens_contact_id_idx ON campaign_tokens(contact_id);

-- ============================================================
-- CRM IMPORTS
-- ============================================================

CREATE TABLE crm_imports (
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

CREATE INDEX crm_imports_org_id_idx ON crm_imports(org_id, created_at DESC);

-- ============================================================
-- NOTIFICATION LOG
-- ============================================================

CREATE TABLE notification_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  type       text NOT NULL CHECK (type IN (
    'sms_threshold', 'sms_form', 'sms_return', 'email_briefing'
  )),
  sent_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notification_log_dedup_idx ON notification_log(org_id, contact_id, type, sent_at DESC);
