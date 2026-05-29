-- HOR-321 · Public API v1 — contact↔property engagement rollup
--
-- The public API's `relationship` resource is a DERIVED, persisted rollup of
-- observable contact↔property engagement. It is NOT the existing
-- `contact_property_relationships` table (that models ownership/tenancy and
-- stays internal). The rollup exposes only observable facts — first/last
-- engagement timestamps and a count — never Horace's interpretation
-- (no score, no intent). See epic HOR-320.
--
-- Three relationship types, each derived from a source that carries a real
-- (contact, property, timestamp) tuple:
--
--   • website_engagement       — property-linked events with a known contact.
--                                Mirrors the Map View join (HOR-216):
--                                coalesce(events.property_id,
--                                         properties->>'property_id').
--   • doorstep_appraisal_request — events on an appraisal page (page_type =
--                                'appraisal') with a known contact + property.
--                                No write path emits these yet; the branch is
--                                future-proofing — the rollup fills itself when
--                                appraisal capture ships.
--   • doorstep_buyer_enquiry   — inspection sign-ins (inspection_scans →
--                                inspections.property_id). The clearest
--                                Doorstep buyer signal we have today.
--
-- Maintenance model: an authoritative FULL RECOMPUTE function, run on a
-- pg_cron schedule (pure SQL — no Edge Function / pg_net hop needed) plus a
-- one-time backfill at the end of this migration. We deliberately avoid
-- per-insert triggers on the high-volume `events` table: events get their
-- `contact_id` populated by the identity pipeline (not always at insert), so a
-- recompute over current state is both simpler and correct. Phase 3 (webhooks,
-- HOR-323) will hook the recompute's diff to emit relationship.created /
-- relationship.updated. `updated_at` is bumped only when a row actually
-- changes, so `updated_since` filters and future webhooks stay meaningful.
--
-- ⚠️ Migration drift: supabase_migrations.schema_migrations is reconciled
-- through 20260513000010. Apply via the Studio SQL editor + manual INSERT of
-- '20260528000010', NOT `supabase db push`, until HOR-131. See
-- ~/.claude/projects/-Users-andytwomey-code/memory/horace_migration_tracking_drift.md.

BEGIN;

-- ============================================================
-- A0. Widen contacts.ingestion_method to allow 'api'
--
-- The public API's POST /v1/contacts creates contacts that surface as
-- source='api'. The public `source` is projected from `ingestion_method`
-- in the API layer, so we need an 'api' value to project from. Re-add the
-- full list (last touched by 20260521000001) plus 'api'. Drop+re-add inside
-- this transaction so there's no window where inserts can violate the shape.
-- ============================================================

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_ingestion_method_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_ingestion_method_check
  CHECK (ingestion_method IN (
    'csv_import', 'crm_sync_rex', 'crm_sync_agentbox', 'crm_sync_vaultre',
    'manual', 'identified_visitor', 'form_submit', 'portal_enquiry',
    'inspection_capture', 'embed_capture', 'api'
  ));

-- ============================================================
-- A. Table
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_property_engagement (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id        uuid NOT NULL REFERENCES contacts(id)   ON DELETE CASCADE,
  property_id       uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  type              text NOT NULL
    CHECK (type IN ('doorstep_buyer_enquiry', 'doorstep_appraisal_request', 'website_engagement')),
  first_engaged_at  timestamptz NOT NULL,
  last_engaged_at   timestamptz NOT NULL,
  engagement_count  integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- One rollup row per (contact, property, type). A contact can hold several
  -- relationship types with the same property (e.g. inspected it AND browsed it).
  UNIQUE (workspace_id, contact_id, property_id, type)
);

-- List/cursor ordering is by (last_engaged_at DESC, id) within a workspace.
CREATE INDEX IF NOT EXISTS cpe_workspace_last_engaged_idx
  ON contact_property_engagement (workspace_id, last_engaged_at DESC, id);
-- `updated_since` filter + future webhook replay.
CREATE INDEX IF NOT EXISTS cpe_workspace_updated_idx
  ON contact_property_engagement (workspace_id, updated_at DESC, id);
-- Per-contact and per-property relationship lookups (the nested list endpoints).
CREATE INDEX IF NOT EXISTS cpe_contact_idx
  ON contact_property_engagement (contact_id, last_engaged_at DESC);
CREATE INDEX IF NOT EXISTS cpe_property_idx
  ON contact_property_engagement (property_id, last_engaged_at DESC);
-- Property scoping for GET /v1/properties (props with >=1 relationship).
CREATE INDEX IF NOT EXISTS cpe_workspace_type_idx
  ON contact_property_engagement (workspace_id, type);

-- ============================================================
-- B. RLS — workspace-scoped reads; writes only via the recompute (service role)
-- ============================================================

ALTER TABLE contact_property_engagement ENABLE ROW LEVEL SECURITY;

-- Read: any member of the workspace. The public API resolves the workspace
-- from the API key and queries via the service role (bypasses RLS), but this
-- policy keeps the table safe for any authenticated/dashboard read too.
DROP POLICY IF EXISTS "cpe_select" ON contact_property_engagement;
CREATE POLICY "cpe_select" ON contact_property_engagement
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

-- No INSERT/UPDATE/DELETE policies: the rollup is derived, never written by a
-- user. Only the SECURITY DEFINER recompute (service role) maintains it.

-- ============================================================
-- C. Recompute — authoritative full rebuild via upsert + prune
-- ============================================================

CREATE OR REPLACE FUNCTION public.refresh_contact_property_engagement()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Derived truth: aggregate every source into one (workspace, contact,
  -- property, type) shape with min/max timestamp and a total count. Both
  -- contact and property must be alive (not soft-deleted).
  WITH derived AS (
    -- website_engagement + doorstep_appraisal_request, from property-linked events.
    SELECT
      e.workspace_id,
      e.contact_id,
      p.pid AS property_id,
      CASE WHEN e.page_type = 'appraisal'
           THEN 'doorstep_appraisal_request'
           ELSE 'website_engagement' END AS type,
      min(e.occurred_at)  AS first_engaged_at,
      max(e.occurred_at)  AS last_engaged_at,
      count(*)::int       AS engagement_count
    FROM events e
    CROSS JOIN LATERAL (
      SELECT coalesce(e.property_id, nullif(e.properties->>'property_id', '')::uuid) AS pid
    ) p
    WHERE e.contact_id IS NOT NULL
      AND p.pid IS NOT NULL
    GROUP BY e.workspace_id, e.contact_id, p.pid,
             (CASE WHEN e.page_type = 'appraisal'
                   THEN 'doorstep_appraisal_request'
                   ELSE 'website_engagement' END)

    UNION ALL

    -- doorstep_buyer_enquiry, from inspection sign-ins.
    SELECT
      s.workspace_id,
      s.contact_id,
      i.property_id,
      'doorstep_buyer_enquiry' AS type,
      min(s.captured_at) AS first_engaged_at,
      max(s.captured_at) AS last_engaged_at,
      count(*)::int      AS engagement_count
    FROM inspection_scans s
    JOIN inspections i ON i.id = s.inspection_id
    WHERE i.property_id IS NOT NULL
    GROUP BY s.workspace_id, s.contact_id, i.property_id
  ),
  alive AS (
    SELECT d.*
    FROM derived d
    JOIN contacts   c ON c.id = d.contact_id  AND c.deleted_at IS NULL
    JOIN properties p ON p.id = d.property_id AND p.deleted_at IS NULL
  ),
  -- Drop rollup rows whose backing source has vanished (e.g. contact merged
  -- away, property purged, soft-deleted). Hard deletes already cascade via FK;
  -- this catches soft-deletes and re-aggregation that empties a key.
  pruned AS (
    DELETE FROM contact_property_engagement cpe
    WHERE NOT EXISTS (
      SELECT 1 FROM alive a
      WHERE a.workspace_id = cpe.workspace_id
        AND a.contact_id   = cpe.contact_id
        AND a.property_id  = cpe.property_id
        AND a.type         = cpe.type
    )
    RETURNING 1
  )
  INSERT INTO contact_property_engagement AS cpe (
    workspace_id, contact_id, property_id, type,
    first_engaged_at, last_engaged_at, engagement_count
  )
  SELECT
    a.workspace_id, a.contact_id, a.property_id, a.type,
    a.first_engaged_at, a.last_engaged_at, a.engagement_count
  FROM alive a
  ON CONFLICT (workspace_id, contact_id, property_id, type) DO UPDATE
    SET first_engaged_at = EXCLUDED.first_engaged_at,
        last_engaged_at  = EXCLUDED.last_engaged_at,
        engagement_count = EXCLUDED.engagement_count,
        -- Only stamp updated_at when something the API exposes actually moved.
        updated_at = CASE
          WHEN cpe.last_engaged_at  IS DISTINCT FROM EXCLUDED.last_engaged_at
            OR cpe.engagement_count IS DISTINCT FROM EXCLUDED.engagement_count
            OR cpe.first_engaged_at IS DISTINCT FROM EXCLUDED.first_engaged_at
          THEN now()
          ELSE cpe.updated_at
        END;
END;
$$;

-- Derived rollup — service role only (the API route is the auth boundary).
-- Matches the lockdown convention from 20260528000003 / the Map View RPCs.
-- NB: anon/authenticated get default EXECUTE on new public functions in this
-- project, so revoke from them explicitly — REVOKE FROM public alone leaves the
-- RPC callable via /rest/v1/rpc/. (Caught by the security advisor on first apply.)
REVOKE ALL ON FUNCTION public.refresh_contact_property_engagement() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_contact_property_engagement() TO service_role;

COMMENT ON TABLE contact_property_engagement IS
  'HOR-321: derived rollup backing the public API relationship resource. Observable facts only (first/last engaged, count) — never score/intent. Maintained by refresh_contact_property_engagement() on a pg_cron schedule.';
COMMENT ON FUNCTION public.refresh_contact_property_engagement() IS
  'HOR-321: authoritative full recompute of contact_property_engagement from events + inspection_scans. Idempotent (upsert + prune). Scheduled via pg_cron; also the one-time backfill. Phase 3 (HOR-323) hooks its diff for relationship webhooks.';

-- ============================================================
-- D. Schedule + one-time backfill
-- ============================================================

-- Every 5 minutes. Pure SQL, so cron runs it directly (no Next.js route / Vault
-- bearer hop — contrast 20260517000011 which must reach an Edge Function).
-- Incremental recompute is a follow-up if event volume makes the full scan
-- costly; at V1 volumes the full rebuild is sub-second.
SELECT cron.schedule(
  'refresh-contact-property-engagement',
  '*/5 * * * *',
  $cron$ SELECT public.refresh_contact_property_engagement(); $cron$
);

-- Backfill now so the API returns data the moment it ships.
SELECT public.refresh_contact_property_engagement();

COMMIT;
