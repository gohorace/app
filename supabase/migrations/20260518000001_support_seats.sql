-- ============================================================
-- HOR-203  Support seats — a new seat type alongside agents
--
-- Three schema changes that introduce Support seats end-to-end without
-- touching the operational `agents.role` vocabulary:
--
--   1. agents.seat_type           — 'agent' | 'support' (default 'agent').
--                                    Every existing row backfills to
--                                    'agent' via the column default.
--   2. workspace_invites.role     — CHECK widened to include 'support'
--                                    so the invite API can carry the new
--                                    seat type through redemption.
--   3. support_seat_assignments   — forward-compat table that binds a
--                                    support seat to one or more agent
--                                    seats. On Pro this is implicit
--                                    (single agent) and the row is
--                                    inserted by accept_workspace_invite
--                                    in HOR-203 migration v2. Office /
--                                    Enterprise multi-assignment lights
--                                    up later with HOR-189.
--
-- Why a separate column rather than a new `agents.role` value:
--   `agents.role` already carries 'agent'|'manager'|'admin' — its
--   operational vocabulary — and is read by RPCs (accept_workspace_invite,
--   stitch_contact_from_inspection, scoring engine). Conflating "what
--   kind of seat is this" with "what's this person's operational role"
--   would force every consumer to re-read the column. seat_type stays
--   orthogonal; permission gates layer on top.
--
-- Permission posture (enforced in app code, not RLS):
--   support seats can read the workspace's signals (workspace_members.role
--   = 'viewer' covers this via existing RLS) but cannot become
--   contacts.owner_agent_id and cannot reach billing/team settings.
--
-- ⚠️ Migration drift: supabase_migrations.schema_migrations is reconciled
-- through 20260513000010. Apply this in the Supabase SQL editor in prod,
-- NOT via `supabase db push`, and manually INSERT the row. See
-- ~/.claude/projects/-Users-andytwomey-code/memory/horace_migration_tracking_drift.md.
-- ============================================================

BEGIN;

-- ============================================================
-- A. agents.seat_type
-- ============================================================

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS seat_type text NOT NULL DEFAULT 'agent'
    CHECK (seat_type IN ('agent', 'support'));

CREATE INDEX IF NOT EXISTS agents_workspace_seat_type_idx
  ON agents (workspace_id, seat_type);

COMMENT ON COLUMN agents.seat_type IS
  'HOR-203: ''agent'' (operational pipeline owner) or ''support'' (admin/PA who actions an agent''s signals). Orthogonal to agents.role — support seats keep role=agent but cannot be primary owner of a lead. Default ''agent'' so existing rows pre-203 backfill to the seat type they always were.';

-- ============================================================
-- B. workspace_invites.role — widen CHECK to include 'support'
-- ============================================================

ALTER TABLE workspace_invites DROP CONSTRAINT IF EXISTS workspace_invites_role_check;
ALTER TABLE workspace_invites
  ADD CONSTRAINT workspace_invites_role_check
    CHECK (role IN ('manager', 'agent', 'support'));

COMMENT ON COLUMN workspace_invites.role IS
  'HOR-203: invite vocabulary now includes ''support''. Redemption maps: manager→members.admin + agents.role=manager + agents.seat_type=agent; agent→members.viewer + agents.role=agent + agents.seat_type=agent; support→members.viewer + agents.role=agent + agents.seat_type=support.';

-- ============================================================
-- C. support_seat_assignments — which agent(s) a support seat covers
-- ============================================================

CREATE TABLE IF NOT EXISTS support_seat_assignments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  support_agent_id    uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  assigned_agent_id   uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (support_agent_id, assigned_agent_id)
);

CREATE INDEX IF NOT EXISTS support_seat_assignments_workspace_idx
  ON support_seat_assignments (workspace_id);

CREATE INDEX IF NOT EXISTS support_seat_assignments_support_idx
  ON support_seat_assignments (support_agent_id);

CREATE INDEX IF NOT EXISTS support_seat_assignments_assigned_idx
  ON support_seat_assignments (assigned_agent_id);

ALTER TABLE support_seat_assignments ENABLE ROW LEVEL SECURITY;

-- SELECT: any workspace member can see the assignments table for their
-- workspace. Used by the daily-briefing cron and the Support section
-- of the settings UI.
DROP POLICY IF EXISTS "support_seat_assignments_select" ON support_seat_assignments;
CREATE POLICY "support_seat_assignments_select" ON support_seat_assignments
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

-- INSERT/DELETE: owner/admin only (matches workspace_invites pattern).
-- The redemption RPC writes via service role and bypasses RLS.
DROP POLICY IF EXISTS "support_seat_assignments_insert" ON support_seat_assignments;
CREATE POLICY "support_seat_assignments_insert" ON support_seat_assignments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = support_seat_assignments.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "support_seat_assignments_delete" ON support_seat_assignments;
CREATE POLICY "support_seat_assignments_delete" ON support_seat_assignments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = support_seat_assignments.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  );

COMMENT ON TABLE support_seat_assignments IS
  'HOR-203: maps a support seat (agents row with seat_type=support) to the agent seat(s) whose signals it covers. On Pro a single row is auto-inserted at invite redemption binding the support seat to workspaces.default_agent_id. Office/Enterprise multi-assignment lands with HOR-189.';
COMMENT ON COLUMN support_seat_assignments.support_agent_id IS
  'The agents.id of the support seat. CHECK against agents.seat_type=''support'' is enforced in the redemption RPC, not in this constraint (avoids a cross-table check that complicates inserts).';
COMMENT ON COLUMN support_seat_assignments.assigned_agent_id IS
  'The agents.id of the agent seat whose signals this support seat can see and action.';

COMMIT;
