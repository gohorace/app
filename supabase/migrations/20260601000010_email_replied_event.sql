-- ============================================================
-- HOR-339 — Digest V2 Phase 3: 'email_replied' event vocabulary
--
-- The digest outcome loop (Sent → Opened → Clicked → Replied) needs an
-- event type that marks a contact having replied to a tracked outbound.
-- email_sends already records sent / opened / clicked / bounce; this adds
-- the missing 'replied' rung to the events vocabulary so the loop can
-- light it up.
--
-- NOTE: nothing emits 'email_replied' yet. Tracked emails are sent through
-- the agent's own Gmail, so replies land in the agent's Gmail inbox — NOT
-- the portal.gohorace.com / Resend inbound webhook. Live reply ingestion is
-- a Gmail-side subsystem split out of Phase 3 (see HOR-339 follow-up). This
-- migration lands the event vocabulary now so the digest outcome loop and
-- the eventual Gmail reply detector slot together with no further schema
-- change. The event is contact-anchored (contact_id set, session_id NULL),
-- so get_contact_events surfaces it automatically (20260519000003 path).
--
-- This migration only widens one CHECK constraint.
--
-- ⚠️ Migration drift active (HOR-131): supabase_migrations.schema_migrations
--    is reconciled through 20260513000010. Apply via the Supabase Studio
--    SQL editor + manual
--      INSERT INTO supabase_migrations.schema_migrations (version)
--        VALUES ('20260601000010');
--    Do NOT `supabase db push`.
-- ============================================================

BEGIN;

-- ── events.event_type ────────────────────────────────────────────────
-- Re-add the full list last set by 20260527000001 (portal_enquiry_capture)
-- + the new 'email_replied' value.
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
    'email_replied',
    'portal_enquiry'
  ));

COMMIT;
