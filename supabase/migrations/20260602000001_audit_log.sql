-- ============================================================
-- HOR-374  Unified audit log  (Phase 2 of the Access Control epic, HOR-373)
--
-- One append-only table recording "who did what, over whose data, when". The
-- handoff spec requires every write / comms / export / assignment / role change
-- to be logged, capturing TWO identities where one acts on behalf of another:
--   • actor_agent_id      — who performed the action (e.g. a Support seat)
--   • acting_as_agent_id  — the agent whose scope it was done in (the delegate's
--                           linked agent). NULL when actor acts in their own scope.
-- These never collapse into one column — that separation IS the audit guarantee.
--
-- Posture:
--   • Append-only. No INSERT/UPDATE/DELETE policies → authenticated/anon callers
--     cannot touch it. Writes happen via the service role (lib/audit/log.ts),
--     which bypasses RLS.
--   • Immutable. A BEFORE UPDATE trigger blocks tampering even via the service
--     role. DELETE is left to the workspace ON DELETE CASCADE + future retention.
--   • Admin-queryable. SELECT is gated to workspace Admins (agents.role='admin')
--     via the new user_admin_workspace_ids() helper.
--
-- ⚠️ Migration drift: apply via the Studio SQL editor + a manual INSERT into
-- supabase_migrations.schema_migrations. Do NOT `supabase db push` (HOR-131).
-- ============================================================

BEGIN;

-- ============================================================
-- A. Helper — workspaces where the caller is a (non-departed) Admin.
--    Canonical "is admin" gate (HOR-376: agents.role is the Role source of
--    truth). Reused by Phase 3/7 admin-only RLS.
-- ============================================================

CREATE OR REPLACE FUNCTION public.user_admin_workspace_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ARRAY(
    SELECT workspace_id
    FROM agents
    WHERE user_id = auth.uid()
      AND role = 'admin'
      AND status <> 'departed'
      AND workspace_id IS NOT NULL
  )
$$;

COMMENT ON FUNCTION public.user_admin_workspace_ids() IS
  'HOR-374: workspace IDs where the current user is a non-departed Admin (agents.role=''admin''). Canonical admin gate for Admin-only RLS (audit_log SELECT, and Phase 3/7 surfaces).';

-- ============================================================
-- B. audit_log
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- actor: SET NULL so the trail survives user/agent deletion (the metadata
  -- snapshot below preserves a human-readable record regardless).
  actor_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_agent_id     uuid REFERENCES agents(id) ON DELETE SET NULL,
  acting_as_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  action             text NOT NULL,   -- e.g. 'contact.update', 'email.send', 'export.account'
  resource_type      text NOT NULL,   -- e.g. 'contact', 'property', 'email', 'member'
  resource_id        uuid,
  scope              text,            -- free-form scope marker ('own' | 'on_behalf' | 'account' | ...)
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_workspace_created_idx
  ON audit_log (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_resource_idx
  ON audit_log (workspace_id, resource_type, resource_id);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx
  ON audit_log (actor_agent_id);

COMMENT ON TABLE audit_log IS
  'HOR-374: append-only audit trail. Captures actor (who acted) and acting_as (the agent whose scope it was, for Support delegation) as two distinct identities. Append-only via RLS (no write policies; service role inserts) + a BEFORE UPDATE immutability trigger.';
COMMENT ON COLUMN audit_log.actor_agent_id IS
  'The agent row of the user who performed the action. For a Support seat, this is the support seat''s own agent id.';
COMMENT ON COLUMN audit_log.acting_as_agent_id IS
  'The agent whose scope the action was performed in, when acting on behalf (Support → linked agent). NULL when the actor acted in their own scope. Never collapsed into actor_agent_id.';

-- ============================================================
-- C. Append-only enforcement
-- ============================================================

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- SELECT: workspace Admins only. (No INSERT/UPDATE/DELETE policies — those
-- operations are denied for authenticated/anon callers; the service role used
-- by lib/audit/log.ts bypasses RLS for inserts.)
DROP POLICY IF EXISTS "audit_log_admin_select" ON audit_log;
CREATE POLICY "audit_log_admin_select" ON audit_log
  FOR SELECT USING (workspace_id = ANY(public.user_admin_workspace_ids()));

-- Immutability: block UPDATE even for the service role / table owner. DELETE is
-- intentionally allowed so workspace ON DELETE CASCADE and retention sweeps work.
CREATE OR REPLACE FUNCTION public.audit_log_block_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; UPDATE is not permitted';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_block_update();

COMMIT;
