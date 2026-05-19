-- ============================================================
-- HOR-243 / HOR-241 — Companion `dismiss` action persistence
--
-- Per-agent, per-signal dismissals captured when the agent confirms
-- the companion's `dismiss` action. The signal is anything an agent
-- can wave away from a daily surface — a digest card, a property
-- suggestion strip, a tracked-email opportunity.
--
-- Scope key is opaque to the table — callers pick the prefix. v2's
-- convention:
--   * digest:contact:<contact-id>
--   * property-suggestion:<property-id>
--   * (extend per surface)
--
-- expires_at: null = forever; non-null = auto-resurface after that
-- timestamp. Digest dismissals typically set expires_at to the next
-- briefing window (NULL means "lose them from view permanently").
--
-- ⚠️ Migration drift active (HOR-131): apply via Supabase Studio SQL
--    editor + manual
--      INSERT INTO supabase_migrations.schema_migrations
--        (version) VALUES ('20260520000001');
--    Do NOT `supabase db push`.
-- ============================================================

BEGIN;

CREATE TABLE dismissed_signals (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id      uuid        NOT NULL REFERENCES agents(id)     ON DELETE CASCADE,
  scope         text        NOT NULL,
  dismissed_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,
  reason        text,
  UNIQUE (agent_id, scope)
);

CREATE INDEX dismissed_signals_workspace_idx
  ON dismissed_signals (workspace_id);

CREATE INDEX dismissed_signals_active_idx
  ON dismissed_signals (agent_id, scope)
  WHERE expires_at IS NULL OR expires_at > now();

-- ============================================================
-- RLS: workspace-scoped reads, agent-scoped writes.
-- An agent can read any dismissal in their workspace (so a teammate
-- dismissing a shared signal doesn't show duplicate cards) — but can
-- only insert / delete their own rows.
-- ============================================================

ALTER TABLE dismissed_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY dismissed_signals_workspace_read
  ON dismissed_signals
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM agents WHERE user_id = auth.uid()
    )
  );

CREATE POLICY dismissed_signals_agent_write
  ON dismissed_signals
  FOR INSERT
  TO authenticated
  WITH CHECK (
    agent_id IN (
      SELECT id FROM agents WHERE user_id = auth.uid()
    )
  );

CREATE POLICY dismissed_signals_agent_delete
  ON dismissed_signals
  FOR DELETE
  TO authenticated
  USING (
    agent_id IN (
      SELECT id FROM agents WHERE user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, DELETE ON dismissed_signals TO authenticated;

COMMIT;
