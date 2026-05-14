-- HOR-146  Doorstep v1 — inspections schema (open homes today, private inspections tomorrow)
--
-- Two tables introduce QR-driven sign-in capture at agent-led property
-- inspections:
--
--   • inspections        — the event the agent runs (one property, one agent,
--                          one window). inspection_type discriminates 'open_home'
--                          (v1) from 'private' (v2) without a future schema change.
--   • inspection_scans   — one row per (inspection, contact) pair. A scan is the
--                          fact "this contact signed in to this inspection".
--                          Subsequent revisits live in `events`, not here.
--
-- Three CHECK widenings unlock the new ingestion/identification/notification
-- paths the rest of HOR-145 builds on top:
--
--   • contacts.ingestion_method        gets 'inspection_capture'
--   • identified_devices.identification_method gets 'inspection_capture'
--   • notification_log.type            gets 'alert_inspection_capture',
--                                            'alert_inspection_revisit'
--
-- The RPC `stitch_contact_from_inspection` lands in HOR-147 (separate ticket
-- so this migration stays focused on tables + constraints + RLS).
--
-- Naming convention (see CLAUDE.md + plan):
--   - Product label:        Doorstep
--   - Code identifiers:     inspection_*  (generic — covers open homes and
--                                          private inspections)
--   - User-facing copy:     "open home" (v1 only writes inspection_type='open_home')
--
-- RLS pattern follows the lists_v1 migration (20260515000001):
--   - SELECT/INSERT/UPDATE/DELETE scoped by public.user_agent_ids() on the
--     agent-owned `inspections` table.
--   - inspection_scans visibility derived through the parent inspection,
--     matching how contact_list_membership defers to lists.
--   - Service role bypasses RLS; the capture endpoint and scoring pipeline
--     use it for the cross-agent writes (contact, identified_device, event,
--     scan, push) that happen on a public form submit.
--
-- ⚠️ Migration drift: `_migrations` table is stale since 2026-04-29. Apply
-- this in the Supabase SQL editor in prod, NOT via `supabase db push`. See
-- ~/.claude/projects/-Users-andytwomey-code/memory/horace_migration_tracking_drift.md.
--
-- See HOR-145 (parent epic) for the full Doorstep v1 plan.

BEGIN;

-- ============================================================
-- A. Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS inspections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id         uuid NOT NULL REFERENCES agents(id)     ON DELETE CASCADE,
  property_id      uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  inspection_type  text NOT NULL DEFAULT 'open_home'
    CHECK (inspection_type IN ('open_home', 'private')),
  token            text NOT NULL UNIQUE,
  scheduled_at     timestamptz NOT NULL,
  window_end_at    timestamptz,
  status           text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE TABLE IF NOT EXISTS inspection_scans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id)  ON DELETE CASCADE,
  inspection_id uuid NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES contacts(id)    ON DELETE CASCADE,
  captured_at   timestamptz NOT NULL DEFAULT now(),
  cookie_id     text,
  UNIQUE (inspection_id, contact_id)
);

-- ============================================================
-- B. Indexes
-- ============================================================

-- Agent's own list view: "what's coming up, what's just finished"
CREATE INDEX IF NOT EXISTS inspections_agent_scheduled_idx
  ON inspections (agent_id, scheduled_at DESC)
  WHERE deleted_at IS NULL;

-- Workspace-wide queries (digest RPC, future team views)
CREATE INDEX IF NOT EXISTS inspections_workspace_scheduled_idx
  ON inspections (workspace_id, scheduled_at DESC)
  WHERE deleted_at IS NULL;

-- Hot path on the public capture page: resolve token → inspection.
-- The UNIQUE constraint on token already creates a btree, but call it out
-- explicitly so future readers see this is a hot lookup, not just a
-- uniqueness guarantee.
CREATE INDEX IF NOT EXISTS inspections_token_alive_idx
  ON inspections (token)
  WHERE deleted_at IS NULL;

-- Detail page query: list scans for an inspection, newest first.
CREATE INDEX IF NOT EXISTS inspection_scans_inspection_captured_idx
  ON inspection_scans (inspection_id, captured_at DESC);

-- Reverse lookup: "which inspections has this contact attended?"
-- Used by the scoring engine to switch return-visit copy to the inspection
-- variant for 30 days after a scan (HOR-154).
CREATE INDEX IF NOT EXISTS inspection_scans_contact_captured_idx
  ON inspection_scans (contact_id, captured_at DESC);

-- ============================================================
-- C. CHECK widenings
-- ============================================================
-- Pattern mirrors 20260513000009_notification_log_volume_review_type.sql.
-- Each constraint is dropped and re-added inside the same transaction so
-- there's no window during which inserts can violate the new shape.

-- contacts.ingestion_method — add 'inspection_capture'
ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_ingestion_method_check;

ALTER TABLE contacts
  ADD CONSTRAINT contacts_ingestion_method_check
  CHECK (ingestion_method IN (
    'csv_import',
    'crm_sync_rex',
    'crm_sync_agentbox',
    'crm_sync_vaultre',
    'manual',
    'identified_visitor',
    'form_submit',
    'portal_enquiry',
    'inspection_capture'
  ));

-- identified_devices.identification_method — add 'inspection_capture'
ALTER TABLE identified_devices
  DROP CONSTRAINT IF EXISTS identified_devices_identification_method_check;

ALTER TABLE identified_devices
  ADD CONSTRAINT identified_devices_identification_method_check
  CHECK (identification_method IN (
    'email_link_click',
    'form_submit',
    'login',
    'manual_merge',
    'inspection_capture'
  ));

-- notification_log.type — add the two new alert types
ALTER TABLE notification_log
  DROP CONSTRAINT IF EXISTS notification_log_type_check;

ALTER TABLE notification_log
  ADD CONSTRAINT notification_log_type_check
  CHECK (type IN (
    'email_daily_brief',
    'alert_score_threshold',
    'alert_form_submit',
    'alert_return_visit',
    'email_workspace_invite',
    'volume_review',
    'alert_inspection_capture',
    'alert_inspection_revisit'
  ));

-- ============================================================
-- D. Trigger — keep updated_at fresh on inspections.
-- Reuses set_updated_at() from 20260408000003_scoring_functions_v2.sql.
-- inspection_scans is append-only, no trigger needed.
-- ============================================================

DROP TRIGGER IF EXISTS inspections_updated_at ON inspections;
CREATE TRIGGER inspections_updated_at
  BEFORE UPDATE ON inspections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- E. RLS
-- ============================================================
-- inspections are owned by a single agent. Tracker/capture writes happen
-- via the service role and bypass these policies; everything below
-- protects dashboard reads and agent-initiated mutations.

ALTER TABLE inspections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_scans ENABLE ROW LEVEL SECURITY;

-- inspections: full CRUD for the owning agent. Soft-deleted rows stay
-- visible so the agent's own historical reports keep working; the
-- application filters on deleted_at IS NULL for surfaces that shouldn't
-- show them (same convention as contacts).

DROP POLICY IF EXISTS "inspections_select" ON inspections;
CREATE POLICY "inspections_select" ON inspections
  FOR SELECT USING (agent_id = ANY(public.user_agent_ids()));

DROP POLICY IF EXISTS "inspections_insert" ON inspections;
CREATE POLICY "inspections_insert" ON inspections
  FOR INSERT WITH CHECK (agent_id = ANY(public.user_agent_ids()));

DROP POLICY IF EXISTS "inspections_update" ON inspections;
CREATE POLICY "inspections_update" ON inspections
  FOR UPDATE
  USING     (agent_id = ANY(public.user_agent_ids()))
  WITH CHECK (agent_id = ANY(public.user_agent_ids()));

DROP POLICY IF EXISTS "inspections_delete" ON inspections;
CREATE POLICY "inspections_delete" ON inspections
  FOR DELETE USING (agent_id = ANY(public.user_agent_ids()));

-- inspection_scans visibility derives from the parent inspection — same
-- shape contact_list_membership uses for lists. SELECT-only at the RLS
-- layer; the capture endpoint inserts via the service role, and we never
-- expose mutate paths on scans to authenticated agents in v1.

DROP POLICY IF EXISTS "inspection_scans_select" ON inspection_scans;
CREATE POLICY "inspection_scans_select" ON inspection_scans
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM inspections i
      WHERE i.id = inspection_scans.inspection_id
        AND i.agent_id = ANY(public.user_agent_ids())
    )
  );

-- ============================================================
-- F. Comments
-- ============================================================

COMMENT ON TABLE inspections IS
  'Agent-led property inspections — open homes today, private inspections (inspection_type=''private'') in v2. Each row owns a unique token used by the public /i/<token> capture page (HOR-151). See HOR-145.';
COMMENT ON COLUMN inspections.inspection_type IS
  'Discriminator that lets one schema cover both open homes and private inspections. v1 only writes ''open_home''. v2 (private inspections) flips a UI selector and lands without a migration.';
COMMENT ON COLUMN inspections.property_id IS
  'Required — every inspection associates to a properties row. The Google Places-backed agent UI (HOR-148) resolves the property before the inspection is saved; there is no free-text fallback.';
COMMENT ON COLUMN inspections.token IS
  'Public capture token. 8-char base62 from generateShortCode(8) — same alphabet and length as /c/<token> for tracked email links. Resolved by the public capture page; never exposed to non-prospects.';
COMMENT ON COLUMN inspections.window_end_at IS
  'Optional. When the inspection''s public window closes. The daily briefing digest (HOR-155) uses this for cut-off ordering when scheduled_at is the same across multiple inspections.';
COMMENT ON COLUMN inspections.agent_id IS
  'Single owning agent (v1). Hard delete cascades — soft delete via deleted_at is the norm.';

COMMENT ON TABLE inspection_scans IS
  'One row per (inspection, contact) capture. The fact "this contact signed in at this inspection". Subsequent revisits are recorded in `events`, not duplicated here. See HOR-145.';
COMMENT ON COLUMN inspection_scans.cookie_id IS
  'Redundant link to identified_devices.cookie_id, kept here for forensic queries — lets us reconstruct device-to-scan attribution without a join through contacts when contacts get merged or reassigned.';

COMMIT;
