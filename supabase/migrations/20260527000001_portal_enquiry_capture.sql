-- ============================================================
-- HOR-233 / HOR-235 — Portal enquiry: timeline event + notification
--
-- When a buyer submits an enquiry on REA / Domain, the inbound router
-- (lib/inbound/router.ts) writes an `enquiries` row but nothing else —
-- so the agent gets no notification (HOR-233) and the contact's activity
-- timeline shows nothing (HOR-235).
--
-- The application change makes the router additionally:
--   1. insert an `events` row (contact-anchored: contact_id set,
--      session_id NULL) so get_contact_events surfaces it on the
--      contact timeline; and
--   2. log + push an `alert_portal_enquiry` notification.
--
-- Both need a CHECK-constraint value that doesn't exist yet:
--   • events.event_type        gets 'portal_enquiry'
--   • notification_log.type     gets 'alert_portal_enquiry'
--
-- This migration only widens those two CHECK constraints. The
-- get_contact_events RPC already UNIONs a contact-anchored path
-- (20260519000003) that picks up "any future contact-only event type"
-- automatically, so no RPC change is needed.
--
-- ⚠️ Migration drift active (HOR-131): supabase_migrations.schema_migrations
--    is reconciled through 20260513000010. Apply via the Supabase Studio
--    SQL editor + manual
--      INSERT INTO supabase_migrations.schema_migrations (version)
--        VALUES ('20260527000001');
--    Do NOT `supabase db push`.
-- ============================================================

BEGIN;

-- ── events.event_type ────────────────────────────────────────────────
-- Re-add the full list last set by 20260519000001 (email_send_v1) + the
-- new 'portal_enquiry' value.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE events ADD CONSTRAINT events_event_type_check
  CHECK (event_type IN (
    'page_view',
    'property_view',
    'form_submit',
    'scroll_depth',
    'return_visit',
    'campaign_click',
    'email_sent',
    'email_opened',
    'email_clicked',
    'email_bounced',
    'portal_enquiry'
  ));

-- ── notification_log.type ────────────────────────────────────────────
-- Re-add the full list last set by 20260521000001 (doorstep_embed_capture)
-- + the new 'alert_portal_enquiry' value.
ALTER TABLE notification_log DROP CONSTRAINT IF EXISTS notification_log_type_check;
ALTER TABLE notification_log ADD CONSTRAINT notification_log_type_check
  CHECK (type IN (
    'email_daily_brief',
    'alert_score_threshold',
    'alert_form_submit',
    'alert_return_visit',
    'email_workspace_invite',
    'volume_review',
    'alert_inspection_capture',
    'alert_inspection_revisit',
    'core_markets_import_complete',
    'alert_embed_capture',
    'alert_portal_enquiry'
  ));

COMMIT;
