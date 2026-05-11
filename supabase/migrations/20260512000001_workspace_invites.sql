-- ============================================================
-- HOR-98  workspace_invites — durable invite rows
--
-- First slice of the Workspaces project. Adds a single table for
-- invite plumbing. Subsequent issues build on top:
--   HOR-99   send-invite API (POST /api/workspaces/:id/invites)
--   HOR-100  redemption flow (/invite/accept + auth callback)
--   HOR-101  revoke invite + remove member endpoints
--   HOR-102  Team settings UI
--   HOR-103  invite email copy pass
--
-- Stacked on andy/hor-65-v1-data-model-phase-1. Rebase to main once
-- PR #20 lands.
--
-- Role enum reconciliation (HOR-65 dependency):
--   workspace_invites.role carries agents.role vocabulary
--   ('manager' | 'agent'). 'admin' is owner-equivalent and not
--   invitable. Redemption (HOR-100) writes this value to
--   agents.role directly and derives workspace_members.role:
--     manager → admin
--     agent   → viewer
--
-- RLS posture (matches HOR-65's stated pattern):
--   SELECT is workspace-scoped via user_workspace_ids().
--   INSERT/UPDATE policies gate on workspace_members.role IN
--   ('owner','admin'). The W-2 API route (HOR-99) writes via the
--   service role, which bypasses RLS — these policies are
--   belt-and-braces against future direct-client writes.
-- ============================================================

BEGIN;

-- ============================================================
-- A. Table
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        text NOT NULL,
  role         text NOT NULL
    CHECK (role IN ('manager', 'agent')),
  invited_by   uuid NOT NULL REFERENCES auth.users(id),
  token_hash   text NOT NULL,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- B. Indexes
-- ============================================================

-- Only one outstanding invite per (workspace, email). Allows a new
-- invite once the previous is accepted or revoked.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_invites_one_outstanding_uidx
  ON workspace_invites (workspace_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Redemption lookup path: sha256(token) → row.
CREATE INDEX IF NOT EXISTS workspace_invites_token_hash_idx
  ON workspace_invites (token_hash);

-- UI lookup: list pending invites for a workspace.
CREATE INDEX IF NOT EXISTS workspace_invites_workspace_pending_idx
  ON workspace_invites (workspace_id, created_at DESC)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ============================================================
-- C. Trigger — reuse set_updated_at() from 20260408000003_scoring_functions_v2.sql
-- ============================================================

DROP TRIGGER IF EXISTS workspace_invites_updated_at ON workspace_invites;
CREATE TRIGGER workspace_invites_updated_at
  BEFORE UPDATE ON workspace_invites
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- D. RLS
-- ============================================================

ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;

-- Members of the workspace see all invites for that workspace
-- (including accepted/revoked, for audit visibility in the UI).
DROP POLICY IF EXISTS "workspace_invites_select" ON workspace_invites;
CREATE POLICY "workspace_invites_select" ON workspace_invites
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

-- Only owner/admin (workspace_members auth scope) can create invites.
DROP POLICY IF EXISTS "workspace_invites_insert" ON workspace_invites;
CREATE POLICY "workspace_invites_insert" ON workspace_invites
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = workspace_invites.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  );

-- Only owner/admin can update invites (used for revoke). Service role
-- bypasses for the redemption path that sets accepted_at.
DROP POLICY IF EXISTS "workspace_invites_update" ON workspace_invites;
CREATE POLICY "workspace_invites_update" ON workspace_invites
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = workspace_invites.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  );

-- ============================================================
-- E. Comments — schema reviewability
-- ============================================================

COMMENT ON TABLE workspace_invites IS
  'Pending and historical invites to join a workspace. Sent via the existing Resend magic-link "invite" template; redeemed at /invite/accept after magic-link auth. See HOR-98..HOR-103.';
COMMENT ON COLUMN workspace_invites.role IS
  'Carries agents.role vocabulary (manager|agent). Redemption derives workspace_members.role: manager→admin, agent→viewer. admin (owner-equivalent) is not invitable.';
COMMENT ON COLUMN workspace_invites.token_hash IS
  'sha256(token). The raw token is sent in the invite email and never stored.';
COMMENT ON COLUMN workspace_invites.accepted_at IS
  'Set non-null on successful redemption. Combined with revoked_at IS NULL, this row is then no longer "outstanding" for the partial unique index.';
COMMENT ON COLUMN workspace_invites.revoked_at IS
  'Set non-null when owner/admin revokes a pending invite. Row retained for audit.';

COMMIT;
