-- HOR-350 · Property V2 — tag stream moments with the property they're about
--
-- The property detail screen (HOR-351) shows a "Surfaced in your Stream"
-- link back to the moment a property last appeared in. notification_log
-- already carries contact_id; this adds the optional property_id so a moment
-- that IS about a property (e.g. an inspection capture, "Horace just met X at
-- <address>") can be tagged at flag time and resolved precisely.
--
-- Nullable: most moments are contact-subject and stay untagged; the read-side
-- resolver (lib/notifications/property-surfaced.ts) prefers a tagged row and
-- falls back to the property's circling contacts, so the link works for
-- untagged moment types (form submit, portal enquiry) too.
--
-- ⚠️ Migration drift: supabase_migrations.schema_migrations is reconciled
-- through 20260513000010. Apply via the Studio SQL editor + a manual
-- INSERT INTO supabase_migrations.schema_migrations (version) VALUES
-- ('20260601000001'), NOT `supabase db push`, until HOR-131. See
-- ~/.claude/projects/-Users-andytwomey-code/memory/horace_migration_tracking_drift.md.

BEGIN;

ALTER TABLE notification_log
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES properties(id) ON DELETE SET NULL;

-- "Latest moment for this property" lookup — the resolver's tag-first query.
CREATE INDEX IF NOT EXISTS notification_log_property_sent_idx
  ON notification_log (property_id, sent_at DESC)
  WHERE property_id IS NOT NULL;

COMMENT ON COLUMN notification_log.property_id IS
  'Optional: the property this moment is about (HOR-350). Set at flag time for '
  'property-subject moments (e.g. inspection capture). Nullable — contact-subject '
  'moments stay untagged and resolve to a property via their contact.';

COMMIT;
