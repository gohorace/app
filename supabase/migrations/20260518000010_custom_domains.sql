-- ============================================================
-- HOR-204  Custom domains for Doorstep
--
-- A verified custom domain is a hard prerequisite for running Doorstep.
-- Trust at the doorstep matters: attendees won't enter details on
-- gohorace.com but they will on the agent's branded URL. Cross-domain
-- attribution (inspection_scans → events) also only works when the
-- capture page is on the agent's own host (see docs/doorstep-metrics.md
-- — the v1 caveat).
--
-- One verified row per workspace at a time. Other rows can sit in
-- pending / verifying / failed / removed states (e.g. mid-swap).
--
-- SSL is provisioned by Vercel automatically once DNS verifies. The
-- ssl_status column mirrors Vercel's view so the settings UI can show
-- "Waiting on certificate" vs "Live".
--
-- ⚠️ Migration drift: supabase_migrations.schema_migrations is reconciled
-- through 20260513000010. Apply this in the Supabase SQL editor in prod
-- and manually INSERT the row. See
-- ~/.claude/projects/-Users-andytwomey-code/memory/horace_migration_tracking_drift.md.
-- ============================================================

BEGIN;

-- ============================================================
-- A. Table
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_custom_domains (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  hostname             text NOT NULL,
  vercel_domain_id     text,
  status               text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verifying', 'verified', 'failed', 'removed')),
  ssl_status           text NOT NULL DEFAULT 'pending'
    CHECK (ssl_status IN ('pending', 'provisioning', 'active', 'failed')),
  dns_target           text NOT NULL DEFAULT 'cname.vercel-dns.com',
  verification_records jsonb,
  last_checked_at      timestamptz,
  verified_at          timestamptz,
  error_message        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- One row per hostname globally — Vercel won't let two projects claim
-- the same hostname, and we want fast lookups by host from the
-- middleware. Case-insensitive on the hostname.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_custom_domains_hostname_uidx
  ON workspace_custom_domains (lower(hostname));

-- Only one verified row per workspace at a time. Mid-swap state allows
-- a pending row alongside an existing verified row, but flipping the
-- new one to verified before the old one is removed is rejected.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_custom_domains_one_verified_per_workspace
  ON workspace_custom_domains (workspace_id)
  WHERE status = 'verified';

-- UI/middleware lookup path.
CREATE INDEX IF NOT EXISTS workspace_custom_domains_workspace_idx
  ON workspace_custom_domains (workspace_id);

-- Cron lookup path — find pending/verifying rows to re-check.
CREATE INDEX IF NOT EXISTS workspace_custom_domains_pending_idx
  ON workspace_custom_domains (status, last_checked_at)
  WHERE status IN ('pending', 'verifying');

-- ============================================================
-- B. Trigger — set_updated_at() defined in 20260408000003
-- ============================================================

DROP TRIGGER IF EXISTS workspace_custom_domains_updated_at ON workspace_custom_domains;
CREATE TRIGGER workspace_custom_domains_updated_at
  BEFORE UPDATE ON workspace_custom_domains
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- C. RLS — owner/admin read+write, no public access
-- ============================================================

ALTER TABLE workspace_custom_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_custom_domains_select" ON workspace_custom_domains;
CREATE POLICY "workspace_custom_domains_select" ON workspace_custom_domains
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

DROP POLICY IF EXISTS "workspace_custom_domains_insert" ON workspace_custom_domains;
CREATE POLICY "workspace_custom_domains_insert" ON workspace_custom_domains
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = workspace_custom_domains.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "workspace_custom_domains_update" ON workspace_custom_domains;
CREATE POLICY "workspace_custom_domains_update" ON workspace_custom_domains
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = workspace_custom_domains.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "workspace_custom_domains_delete" ON workspace_custom_domains;
CREATE POLICY "workspace_custom_domains_delete" ON workspace_custom_domains
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = workspace_custom_domains.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  );

-- ============================================================
-- D. Comments
-- ============================================================

COMMENT ON TABLE workspace_custom_domains IS
  'HOR-204: per-workspace custom domains for Doorstep capture pages. One verified row per workspace at a time; SSL provisioned via Vercel Domains API (Let''s Encrypt under the hood).';
COMMENT ON COLUMN workspace_custom_domains.hostname IS
  'Lowercased fully-qualified hostname (e.g. inspections.agentname.com.au). Globally unique.';
COMMENT ON COLUMN workspace_custom_domains.vercel_domain_id IS
  'The id returned by POST /v10/projects/:id/domains. Null until first registration attempt succeeds.';
COMMENT ON COLUMN workspace_custom_domains.status IS
  'pending → verifying → verified | failed. removed = soft-detached (Doorstep capture paused, data preserved).';
COMMENT ON COLUMN workspace_custom_domains.ssl_status IS
  'Mirrors Vercel''s SSL provisioning state — pending until DNS resolves, then provisioning, then active. Failed terminal states surface to the UI.';
COMMENT ON COLUMN workspace_custom_domains.verification_records IS
  'Raw verification array returned by the Vercel API. JSONB so future record types (CAA, TXT) survive without a schema change.';

COMMIT;
