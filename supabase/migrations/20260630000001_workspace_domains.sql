-- ============================================================
-- First-party tracking architecture — W2: data model
--
-- Serves the tracker (/tracker.min.js, /api/t), embed and inspection
-- capture from each agent's own subdomain (e.g. t.raywhitecaloundra.com.au)
-- via Cloudflare for SaaS + a Cloudflare Worker, with a server-set
-- HttpOnly _riq_aid cookie that survives Safari ITP's 7-day cap.
--
-- This is the foundation only: the table + a workspaces pointer to the
-- active domain. The Cloudflare provisioning service, the cron poller,
-- the edge Worker and the snippet/tracker changes land in follow-on PRs.
--
-- ⚠️ Intentionally SEPARATE from workspace_custom_domains (HOR-204). That
-- table is the Vercel-based Doorstep custom-domain system; this one is the
-- Cloudflare-based first-party *tracking* hostname system. Different
-- provider, different lifecycle, different status vocabulary ('active' vs
-- 'verified'). A future refactor could unify them behind one provider
-- abstraction — out of scope here.
--
-- ⚠️ Migration drift: confirm supabase_migrations.schema_migrations is
-- current before `db push`. If applying by hand in the Supabase SQL editor,
-- INSERT the tracking row manually. See
-- ~/.claude/projects/-Users-andytwomey-code/memory/horace_migration_tracking_drift.md.
-- ============================================================

BEGIN;

-- ============================================================
-- A. Table
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_domains (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  hostname                  text NOT NULL,                 -- 't.raywhitecaloundra.com.au'
  apex_domain               text NOT NULL,                 -- 'raywhitecaloundra.com.au' (cookie Domain=)
  status                    text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verifying', 'active', 'failed', 'deleted')),
  cloudflare_hostname_id    text,                          -- CF custom_hostnames API id
  verification_record_name  text,                          -- TXT / CNAME record for ownership proof
  verification_record_value text,
  cert_status               text
    CHECK (cert_status IS NULL OR cert_status IN ('pending', 'issued', 'renewing', 'failed')),
  cert_issued_at            timestamptz,
  last_checked_at           timestamptz,
  failure_reason            text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  activated_at              timestamptz
);

-- One row per hostname globally — Cloudflare for SaaS won't let two zones
-- claim the same custom hostname, and edge routing keys on it. Scoped to
-- non-deleted rows so a workspace can re-provision a host it soft-deleted.
-- Case-insensitive on the hostname. (The spec wrote `hostname ... unique`;
-- this partial unique index is the same guarantee but survives soft-delete.)
CREATE UNIQUE INDEX IF NOT EXISTS workspace_domains_hostname_uidx
  ON workspace_domains (lower(hostname))
  WHERE status != 'deleted';

-- UI / edge-sync lookup path.
CREATE INDEX IF NOT EXISTS workspace_domains_workspace_id_idx
  ON workspace_domains (workspace_id);

-- General status filter, excluding tombstones.
CREATE INDEX IF NOT EXISTS workspace_domains_status_idx
  ON workspace_domains (status)
  WHERE status != 'deleted';

-- Cron lookup path (PR 2) — find pending/verifying rows to re-check.
CREATE INDEX IF NOT EXISTS workspace_domains_pending_idx
  ON workspace_domains (status, last_checked_at)
  WHERE status IN ('pending', 'verifying');

-- ============================================================
-- B. workspaces.tracking_domain_id — pointer to the active domain
--    for fast lookup during snippet generation (PR 3).
-- ============================================================

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS tracking_domain_id uuid REFERENCES workspace_domains(id);

-- ============================================================
-- C. Trigger — set_updated_at() defined in 20260408000003
-- ============================================================

DROP TRIGGER IF EXISTS workspace_domains_updated_at ON workspace_domains;
CREATE TRIGGER workspace_domains_updated_at
  BEFORE UPDATE ON workspace_domains
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- D. RLS — workspace members read; owner/admin write
--    (mirrors workspace_custom_domains exactly).
-- ============================================================

ALTER TABLE workspace_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_domains_select" ON workspace_domains;
CREATE POLICY "workspace_domains_select" ON workspace_domains
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

DROP POLICY IF EXISTS "workspace_domains_insert" ON workspace_domains;
CREATE POLICY "workspace_domains_insert" ON workspace_domains
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = workspace_domains.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "workspace_domains_update" ON workspace_domains;
CREATE POLICY "workspace_domains_update" ON workspace_domains
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = workspace_domains.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "workspace_domains_delete" ON workspace_domains;
CREATE POLICY "workspace_domains_delete" ON workspace_domains
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = workspace_domains.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  );

-- ============================================================
-- E. Comments
-- ============================================================

COMMENT ON TABLE workspace_domains IS
  'First-party tracking hostnames (Cloudflare for SaaS). One active row per hostname; serves tracker / embed / inspection capture from the agent''s own subdomain. Separate from workspace_custom_domains (Vercel-based Doorstep domains).';
COMMENT ON COLUMN workspace_domains.hostname IS
  'Fully-qualified tracking subdomain, e.g. t.agentname.com.au. Enforced ''t.'' prefix at the application layer. Globally unique among non-deleted rows.';
COMMENT ON COLUMN workspace_domains.apex_domain IS
  'Registrable apex, e.g. agentname.com.au. Used as the cookie Domain= attribute when the edge Worker sets _riq_aid.';
COMMENT ON COLUMN workspace_domains.status IS
  'pending → verifying → active | failed. deleted = soft-removed (CF hostname torn down, row preserved for audit).';
COMMENT ON COLUMN workspace_domains.cloudflare_hostname_id IS
  'The id returned by the Cloudflare custom_hostnames API. Null until first provision attempt succeeds.';
COMMENT ON COLUMN workspace_domains.cert_status IS
  'Cloudflare-managed (Let''s Encrypt) cert lifecycle: pending → issued → renewing | failed. Null before issuance begins.';

COMMENT ON COLUMN workspaces.tracking_domain_id IS
  'Active first-party tracking domain (workspace_domains.id), or NULL to fall back to the gohorace.com tracker path.';

COMMIT;
