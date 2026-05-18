-- ============================================================
-- HOR-223 / HOR-106 — Tracked email v1 schema + event contract
--
-- Slice A of HOR-106 ('v1 spec — Tracked 1:1 email send via
-- Gmail API'). Lands all DB shape in one migration so slices
-- B/C/D never block on a follow-up DDL.
--
-- Tables added:
--   * agent_integrations       — per-agent Gmail OAuth state
--   * email_sends              — one row per send attempt
--   * agent_email_exclusions   — per-agent send-suppression rules
--
-- Events table changes:
--   * Adds email_sent | email_opened | email_clicked | email_bounced
--     to event_type CHECK (preserving all existing values).
--   * Makes session_id nullable + adds
--     (session_id IS NOT NULL OR contact_id IS NOT NULL) CHECK.
--
-- RPCs (SECURITY DEFINER):
--   * emit_email_event(p_send_id, p_event, p_props)
--   * is_recipient_excluded(p_agent_id, p_email)
--
-- Seeds AU-default exclusions for all existing agents + trigger
-- to seed on agents INSERT.
--
-- ⚠️ Migration drift active (HOR-131): apply via Supabase Studio
--    SQL editor + manual
--      INSERT INTO supabase_migrations.schema_migrations
--        (version) VALUES ('20260519000001');
--    Do NOT `supabase db push`.
-- ============================================================

BEGIN;

-- ============================================================
-- A. agent_integrations
-- Per-agent OAuth integration state. provider column is an enum
-- stub; 'gmail' is the only value for HOR-106. Future providers
-- (e.g. 'outlook') extend the CHECK without touching callers.
-- vault_secret_id points to vault.secrets.id — no FK enforced
-- here because vault lives in a separate schema and the secret
-- must be created before the integration row is written.
-- ============================================================

CREATE TABLE agent_integrations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id         uuid        NOT NULL REFERENCES agents(id)     ON DELETE CASCADE,
  provider         text        NOT NULL
                                 CHECK (provider IN ('gmail')),
  status           text        NOT NULL DEFAULT 'connected'
                                 CHECK (status IN (
                                   'connected',
                                   'refresh_revoked',
                                   'workspace_admin_blocked',
                                   'disconnected'
                                 )),
  external_account text        NOT NULL,
  scope            text        NOT NULL,
  vault_secret_id  uuid        NOT NULL,
  last_refreshed_at timestamptz,
  last_error       text,
  connected_at     timestamptz NOT NULL DEFAULT now(),
  disconnected_at  timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, provider)
);

CREATE INDEX agent_integrations_workspace_idx
  ON agent_integrations (workspace_id);

DROP TRIGGER IF EXISTS agent_integrations_updated_at ON agent_integrations;
CREATE TRIGGER agent_integrations_updated_at
  BEFORE UPDATE ON agent_integrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- B. email_sends
-- One row per outbound email attempt.
--
-- Slice D will dual-write to outreach_log (the existing channel
-- aggregation table) and email_sends. The link is:
--   outreach_log.external_id = email_sends.provider_message_id
-- Do NOT modify outreach_log in this slice.
--
-- contact_id is nullable to allow sends to non-contact addresses
-- (e.g. test sends, cold-blast imports not yet in the contact
-- graph). emit_email_event() guards against NULL contact_id and
-- will return NULL rather than produce an unanchored events row.
-- ============================================================

CREATE TABLE email_sends (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id            uuid        NOT NULL REFERENCES agents(id)     ON DELETE CASCADE,
  contact_id          uuid                 REFERENCES contacts(id)   ON DELETE SET NULL,
  to_email            text        NOT NULL,
  subject             text        NOT NULL,
  body_html           text        NOT NULL,
  body_text           text,
  tracked             boolean     NOT NULL DEFAULT true,
  provider            text        NOT NULL DEFAULT 'gmail'
                                    CHECK (provider IN ('gmail')),
  provider_message_id text,
  provider_thread_id  text,
  status              text        NOT NULL DEFAULT 'queued'
                                    CHECK (status IN (
                                      'queued',
                                      'sent',
                                      'soft_bounced',
                                      'hard_bounced',
                                      'failed',
                                      'spam_complaint'
                                    )),
  error_code          text,
  error_message       text,
  sent_at             timestamptz,
  first_opened_at     timestamptz,
  first_clicked_at    timestamptz,
  open_count          int         NOT NULL DEFAULT 0,
  click_count         int         NOT NULL DEFAULT 0,
  links               jsonb       NOT NULL DEFAULT '[]'::jsonb,
  source              text        NOT NULL DEFAULT 'ui'
                                    CHECK (source IN ('ui', 'mcp', 'digest_prompt')),
  retry_count         int         NOT NULL DEFAULT 0,
  next_retry_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_sends_contact_sent_idx
  ON email_sends (contact_id, sent_at DESC)
  WHERE contact_id IS NOT NULL;

CREATE INDEX email_sends_agent_sent_idx
  ON email_sends (agent_id, sent_at DESC);

CREATE INDEX email_sends_provider_message_id_idx
  ON email_sends (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

DROP TRIGGER IF EXISTS email_sends_updated_at ON email_sends;
CREATE TRIGGER email_sends_updated_at
  BEFORE UPDATE ON email_sends
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- C. agent_email_exclusions
-- Per-agent send-suppression rules. Two kinds:
--   email  — exact lowercased address ('someone@example.com')
--   domain — '*@domain' wildcard      ('*@realestate.com.au')
-- AU-default domain seeds and trigger follow below.
-- ============================================================

CREATE TABLE agent_email_exclusions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     uuid        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  pattern      text        NOT NULL,
  pattern_kind text        NOT NULL CHECK (pattern_kind IN ('email', 'domain')),
  reason       text,
  source       text        NOT NULL DEFAULT 'agent'
                             CHECK (source IN ('agent', 'seeded', 'auto_bounce')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, pattern)
);

CREATE INDEX agent_email_exclusions_agent_idx
  ON agent_email_exclusions (agent_id);

-- ============================================================
-- D. EVENTS — widen event_type CHECK + make session_id nullable
--
-- Baseline constraint events_event_type_check was created inline
-- in 20260408000001_workspaces_agents.sql; PostgreSQL auto-named
-- it events_event_type_check. Phase 1 (20260511000001) explicitly
-- left it untouched. We DROP + re-ADD to include the 4 new values.
--
-- Existing values preserved exactly:
--   page_view, property_view, form_submit,
--   scroll_depth, return_visit, campaign_click
-- ============================================================

ALTER TABLE events DROP CONSTRAINT events_event_type_check;

ALTER TABLE events ADD CONSTRAINT events_event_type_check
  CHECK (event_type IN (
    'page_view',
    'property_view',
    'form_submit',
    'scroll_depth',
    'return_visit',
    'campaign_click',
    'email_sent',
    'email_opened',
    'email_clicked',
    'email_bounced'
  ));

-- Drop NOT NULL so email-tracking events (no browser session) can land.
-- The FK (REFERENCES sessions ON DELETE CASCADE) remains; NULL session_id
-- is allowed by standard FK semantics (NULL never violates a FK).
ALTER TABLE events ALTER COLUMN session_id DROP NOT NULL;

-- Ship as NOT VALID: the constraint is enforced for new inserts but
-- existing rows are not scanned at migration time. This avoids an
-- AccessExclusiveLock table scan on a potentially large events table
-- and protects against any Phase 1 backfill rows that may have
-- landed with session_id IS NULL (e.g. from partial runs).
--
-- ⚠️ Andy: after confirming
--     SELECT count(*) FROM events WHERE session_id IS NULL AND contact_id IS NULL;
--   returns 0, run:
--     ALTER TABLE events VALIDATE CONSTRAINT events_session_or_contact;
ALTER TABLE events ADD CONSTRAINT events_session_or_contact
  CHECK (session_id IS NOT NULL OR contact_id IS NOT NULL) NOT VALID;

-- ============================================================
-- E. RPC: emit_email_event
-- Called by the tracking endpoint (Gmail webhook / pixel route)
-- to record open, click, bounce, and sent events, and to update
-- the corresponding email_sends counters atomically.
--
-- Returns the new events.id on success, NULL when the send_id
-- does not exist or the send has no linked contact_id (an
-- unanchored event cannot satisfy events_session_or_contact).
-- Slice D must only call this for sends where contact_id IS NOT NULL.
--
-- SECURITY DEFINER: the tracking endpoint uses the service-role
-- client, but individual RPC callers should not have naked write
-- access to events or email_sends. search_path locked to prevent
-- search-path injection.
-- ============================================================

CREATE OR REPLACE FUNCTION emit_email_event(
  p_send_id uuid,
  p_event   text,
  p_props   jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_send     email_sends%ROWTYPE;
  v_event_id uuid;
BEGIN
  SELECT * INTO v_send FROM email_sends WHERE id = p_send_id;
  IF v_send.id IS NULL THEN RETURN NULL; END IF;

  -- An events row requires at least one identity anchor
  -- (session_id IS NOT NULL OR contact_id IS NOT NULL).
  -- Email events have no session; without a contact we cannot
  -- satisfy events_session_or_contact, so we return NULL rather
  -- than raise an error. Slice D should only call emit_email_event
  -- for sends where contact_id IS NOT NULL.
  IF v_send.contact_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO events (
    workspace_id,
    session_id,
    contact_id,
    event_type,
    properties,
    occurred_at,
    attributed_agent_id
  )
  VALUES (
    v_send.workspace_id,
    NULL,
    v_send.contact_id,
    p_event,
    jsonb_build_object('email_send_id', p_send_id) || p_props,
    now(),
    v_send.agent_id
  )
  RETURNING id INTO v_event_id;

  IF p_event = 'email_opened' THEN
    UPDATE email_sends
       SET open_count      = open_count + 1,
           first_opened_at = COALESCE(first_opened_at, now())
     WHERE id = p_send_id;

  ELSIF p_event = 'email_clicked' THEN
    UPDATE email_sends
       SET click_count       = click_count + 1,
           first_clicked_at  = COALESCE(first_clicked_at, now())
     WHERE id = p_send_id;

  ELSIF p_event = 'email_bounced' THEN
    -- bounce_kind must be a valid email_sends.status value
    -- ('soft_bounced' | 'hard_bounced'); caller is responsible.
    UPDATE email_sends
       SET status = COALESCE(p_props->>'bounce_kind', 'hard_bounced')
     WHERE id = p_send_id;
  END IF;

  RETURN v_event_id;
END $$;

GRANT EXECUTE ON FUNCTION emit_email_event(uuid, text, jsonb)
  TO authenticated, service_role;

-- ============================================================
-- F. RPC: is_recipient_excluded
-- Returns (true, reason) for the highest-priority exclusion hit,
-- or (false, NULL) when the address is clear to send to.
--
-- Priority order (first match wins):
--   1. contacts.unsubscribed_at  — recipient-driven opt-out
--   2. agent_email_exclusions    — exact email match
--   3. agent_email_exclusions    — '*@domain' domain match
--   4. sentinel                  — not excluded
--
-- Always returns exactly one row.
-- STABLE: no writes; search_path locked.
-- ============================================================

CREATE OR REPLACE FUNCTION is_recipient_excluded(
  p_agent_id uuid,
  p_email    text
) RETURNS TABLE (excluded boolean, reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH hits AS (

    -- 1. Contact opted out directly (recipient-driven)
    SELECT 1                AS prio,
           true             AS excluded,
           'unsubscribed'   AS reason
    FROM contacts
    WHERE (agent_id = p_agent_id OR owner_agent_id = p_agent_id)
      AND lower(email) = lower(p_email)
      AND unsubscribed_at IS NOT NULL

    UNION ALL

    -- 2. Agent-level exclusion: exact email address
    SELECT 2,
           true,
           aee.reason
    FROM agent_email_exclusions aee
    WHERE aee.agent_id    = p_agent_id
      AND aee.pattern_kind = 'email'
      AND aee.pattern      = lower(p_email)

    UNION ALL

    -- 3. Agent-level exclusion: domain wildcard ('*@domain')
    SELECT 3,
           true,
           aee.reason
    FROM agent_email_exclusions aee
    WHERE aee.agent_id    = p_agent_id
      AND aee.pattern_kind = 'domain'
      AND aee.pattern      = '*@' || split_part(lower(p_email), '@', 2)

    UNION ALL

    -- Sentinel: no exclusion found — always yields one row
    SELECT 99, false, NULL
  )
  SELECT excluded, reason
  FROM hits
  ORDER BY prio
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION is_recipient_excluded(uuid, text)
  TO authenticated, service_role;

-- ============================================================
-- G. AU-default exclusion seed
-- These five portal/aggregator domains must not receive cold
-- outbound email from agents (Spam Act compliance + platform ToS).
-- Seed for all existing agents; the trigger below handles new ones.
-- pattern_kind='domain' matches via '*@<domain>' in is_recipient_excluded.
-- ============================================================

INSERT INTO agent_email_exclusions (agent_id, pattern, pattern_kind, reason, source)
SELECT a.id, p.pattern, 'domain', 'au_default', 'seeded'
FROM   agents a
CROSS  JOIN (VALUES
  ('*@realestate.com.au'),
  ('*@domain.com.au'),
  ('*@view.com.au'),
  ('*@rea-group.com'),
  ('*@homely.com.au')
) AS p(pattern)
ON CONFLICT (agent_id, pattern) DO NOTHING;

CREATE OR REPLACE FUNCTION seed_default_email_exclusions()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO agent_email_exclusions (agent_id, pattern, pattern_kind, reason, source)
  VALUES
    (NEW.id, '*@realestate.com.au', 'domain', 'au_default', 'seeded'),
    (NEW.id, '*@domain.com.au',     'domain', 'au_default', 'seeded'),
    (NEW.id, '*@view.com.au',       'domain', 'au_default', 'seeded'),
    (NEW.id, '*@rea-group.com',     'domain', 'au_default', 'seeded'),
    (NEW.id, '*@homely.com.au',     'domain', 'au_default', 'seeded')
  ON CONFLICT (agent_id, pattern) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS agents_seed_email_exclusions ON agents;
CREATE TRIGGER agents_seed_email_exclusions
  AFTER INSERT ON agents
  FOR EACH ROW EXECUTE FUNCTION seed_default_email_exclusions();

-- ============================================================
-- H. RLS
-- Service-role admin client (send route + tracking endpoints)
-- bypasses RLS via Supabase's admin client — these policies
-- govern authenticated UI reads by the owning agent only.
-- ============================================================

ALTER TABLE agent_integrations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_sends            ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_email_exclusions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_integrations_all ON agent_integrations;
CREATE POLICY agent_integrations_all ON agent_integrations
  USING     (agent_id = ANY(public.user_agent_ids()))
  WITH CHECK (agent_id = ANY(public.user_agent_ids()));

DROP POLICY IF EXISTS email_sends_all ON email_sends;
CREATE POLICY email_sends_all ON email_sends
  USING     (agent_id = ANY(public.user_agent_ids()))
  WITH CHECK (agent_id = ANY(public.user_agent_ids()));

DROP POLICY IF EXISTS agent_email_exclusions_all ON agent_email_exclusions;
CREATE POLICY agent_email_exclusions_all ON agent_email_exclusions
  USING     (agent_id = ANY(public.user_agent_ids()))
  WITH CHECK (agent_id = ANY(public.user_agent_ids()));

COMMIT;
