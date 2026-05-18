-- ============================================================
-- HOR-204  workspace_custom_domains.dns_provider
--
-- Records the detected DNS provider for the apex of each row's
-- hostname so the settings UI can render provider-tailored CNAME
-- instructions without re-resolving NS records on every page load.
-- Populated by POST /api/domains via dns.resolveNs() once at create
-- time; never reads from this column in the hot capture path.
--
-- Values match the DnsProvider union in lib/dns/detect.ts:
--   cloudflare | route53 | namecheap | godaddy | vercel | other | unknown
--
-- Default 'unknown' keeps existing rows valid and means we render the
-- generic instructions for them (the same behaviour as pre-HOR-204).
--
-- ⚠️ Migration drift: supabase_migrations.schema_migrations is reconciled
-- through 20260513000010. Apply via Studio SQL editor + manual INSERT
-- into supabase_migrations.schema_migrations.
-- ============================================================

BEGIN;

ALTER TABLE workspace_custom_domains
  ADD COLUMN IF NOT EXISTS dns_provider text NOT NULL DEFAULT 'unknown'
    CHECK (dns_provider IN (
      'cloudflare', 'route53', 'namecheap', 'godaddy', 'vercel', 'other', 'unknown'
    ));

COMMENT ON COLUMN workspace_custom_domains.dns_provider IS
  'HOR-204: classification of the apex zone''s DNS provider, populated by NS lookup at row create time. UI hint only — never gate flow on this value.';

COMMIT;
