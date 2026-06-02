-- HOR-375 (Phase 7 of the Access Control epic, HOR-373) — data ownership & export.
--
-- Two export paths (the routes + capability gates live in app code):
--   • Account export — Admin only, whole-account sovereign layer.
--   • Agent self-export — own scope only, and ONLY when an Admin has granted it.
--     No unilateral agent export. That grant is this table.
--
-- ⚠ The user-facing export must not LAUNCH until Marketing refocuses the
-- trust-page copy from individual "your data" to account-level sovereignty
-- (Andy, 2026-06-02 — reverses CLAUDE.md hard rule #1 for the individual). The
-- app gates the launch behind EXPORT_ENABLED (lib/export); this migration is the
-- inert data layer.
--
-- Every export action is logged to audit_log (export.account / export.scope) from
-- the routes — not here.

CREATE TABLE public.export_grants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  granted_to_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  granted_by_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  scope               text NOT NULL DEFAULT 'own_scope' CHECK (scope IN ('own_scope')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- NULL = no expiry (open-ended grant); otherwise the grant lapses at this time.
  expires_at          timestamptz
);

CREATE INDEX export_grants_agent_idx ON public.export_grants (granted_to_agent_id);
CREATE INDEX export_grants_workspace_idx ON public.export_grants (workspace_id);

-- RLS: workspace members may READ grants (an agent sees their own; an admin sees
-- the workspace's). Writes are service-role only — the Admin grant/revoke route
-- uses the service client after its own capability check. No authenticated write
-- policy → authenticated cannot insert/update/delete directly.
ALTER TABLE public.export_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY export_grants_select ON public.export_grants
  FOR SELECT
  USING (workspace_id = ANY (user_workspace_ids()));
