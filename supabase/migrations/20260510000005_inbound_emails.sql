-- ============================================================
-- Inbound emails (HOR-63)
--
-- One row per email received via Resend's email.received webhook.
-- Replaces the inbound_email_samples spike table (which is left in
-- place for now and will be dropped in HOR-63 cleanup phase).
--
-- Stores both webhook metadata and the body fetched separately via
-- Resend's Received Emails API. parse_status tracks the lifecycle:
--   pending_body → parsed | parse_failed | no_match
-- ============================================================

CREATE TABLE inbound_emails (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid        REFERENCES agents(id) ON DELETE SET NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  source_portal   text,
  message_id      text        UNIQUE,
  webhook_payload jsonb       NOT NULL,
  fetched_payload jsonb,
  parse_status    text        NOT NULL DEFAULT 'pending_body'
    CHECK (parse_status IN ('pending_body', 'parsed', 'parse_failed', 'no_match')),
  parse_error     text
);

CREATE INDEX inbound_emails_agent_id_idx
  ON inbound_emails(agent_id);

CREATE INDEX inbound_emails_received_at_idx
  ON inbound_emails(received_at DESC);

-- Partial index for the ops review path: anything not cleanly parsed.
CREATE INDEX inbound_emails_unresolved_idx
  ON inbound_emails(received_at DESC)
  WHERE parse_status <> 'parsed';

ALTER TABLE inbound_emails ENABLE ROW LEVEL SECURITY;

-- Workspace members can read inbound_emails for any of their agents.
-- agent_id NULL (unmatched address) is service-role-only — visible only
-- via admin tooling, not surfaced into any workspace's UI.
CREATE POLICY "inbound_emails_select" ON inbound_emails
  FOR SELECT USING (
    agent_id IS NOT NULL AND agent_id IN (
      SELECT id FROM agents WHERE workspace_id = ANY(public.user_workspace_ids())
    )
  );

COMMENT ON TABLE inbound_emails IS
  'Captured inbound emails from Resend (HOR-63). Replaces inbound_email_samples.';
