-- ============================================================
-- HOR-378  Two-identity comms  (Phase 4 of the Access Control epic, HOR-373)
--
-- A Support seat acts on behalf of a linked agent. When it sends an email the
-- VENDOR must see the agent (email_sends.agent_id stays the linked agent — the
-- vendor-facing / Gmail identity), but we must also record WHO actually pressed
-- send. These two identities never collapse:
--   • agent_id        — the agent the email is attributed to (vendor-facing).
--   • acting_user_id   — the human who performed the send (the Support user, or
--                        the agent's own user on a normal send).
--
-- The audit_log row written alongside the send carries the agent-level pair
-- (actor_agent_id = the Support seat, acting_as_agent_id = the linked agent);
-- this column ties the email row itself back to the human actor.
--
-- ⚠️ Migration drift: apply via Studio SQL editor + manual INSERT into
-- supabase_migrations.schema_migrations. Do NOT `supabase db push` (HOR-131).
-- ============================================================

BEGIN;

ALTER TABLE email_sends
  ADD COLUMN IF NOT EXISTS acting_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN email_sends.acting_user_id IS
  'HOR-378: the human who performed the send. Differs from agent_id''s owning user when a Support seat sends on behalf of its linked agent. NULL on legacy rows and on MCP sends (the token IS the agent). Never collapsed into agent_id, which stays the vendor-facing identity.';

CREATE INDEX IF NOT EXISTS email_sends_acting_user_idx
  ON email_sends (acting_user_id)
  WHERE acting_user_id IS NOT NULL;

COMMIT;
