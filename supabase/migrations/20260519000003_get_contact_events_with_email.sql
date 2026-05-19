-- ============================================================
-- HOR-228 / HOR-106 — get_contact_events: include email events
--
-- Slice F of HOR-106. Slice A added email_sent / email_opened /
-- email_clicked / email_bounced as valid event_type values, but the
-- existing get_contact_events RPC (defined in
-- 20260408000003_scoring_functions_v2.sql) joins events through
-- identity_map → sessions → events.session_id. Email events have
-- session_id IS NULL and contact_id IS NOT NULL, so the original
-- query filters them out.
--
-- This migration replaces the function with a UNION ALL:
--   1. Existing session-anchored path (unchanged) — visits, form
--      submits, scroll depth, etc.
--   2. New contact-anchored path — events where session_id IS NULL
--      and contact_id = p_contact_id. Captures every email_*
--      emission (and any future contact-only event type).
--
-- The function signature is unchanged; clients (contact detail
-- page, /api/contacts/[id]/events) get the union transparently.
--
-- ⚠️ Migration drift active (HOR-131): apply via Supabase Studio
--    SQL editor + manual
--      INSERT INTO supabase_migrations.schema_migrations
--        (version) VALUES ('20260519000003');
--    Do NOT `supabase db push`.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION get_contact_events(p_contact_id uuid)
RETURNS TABLE (
  event_id     uuid,
  event_type   text,
  properties   jsonb,
  score_delta  int,
  occurred_at  timestamptz,
  anonymous_id text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- ── Session-anchored events (existing path) ───────────────────────────
  -- Visits, page views, scroll depth, return visits, campaign clicks, etc.
  -- Resolved through identity_map so the contact's pre-identification
  -- session history is included.
  SELECT
    e.id           AS event_id,
    e.event_type,
    e.properties,
    e.score_delta,
    e.occurred_at,
    s.anonymous_id
  FROM identity_map im
  JOIN sessions s
    ON  s.workspace_id = im.workspace_id
    AND s.anonymous_id = im.anonymous_id
  JOIN events e
    ON  e.session_id = s.id
  WHERE im.contact_id = p_contact_id

  UNION ALL

  -- ── Contact-anchored events (new — slice F) ───────────────────────────
  -- Events where session_id IS NULL but contact_id matches: today, that's
  -- the email_* family (emit_email_event always inserts with session_id=NULL
  -- and contact_id from the email_sends row). Any future contact-only event
  -- types land here automatically without further RPC changes.
  SELECT
    e.id           AS event_id,
    e.event_type,
    e.properties,
    e.score_delta,
    e.occurred_at,
    NULL::text     AS anonymous_id
  FROM events e
  WHERE e.contact_id  = p_contact_id
    AND e.session_id  IS NULL

  ORDER BY occurred_at DESC;
$$;

-- GRANT EXECUTE is preserved from the original CREATE; CREATE OR REPLACE
-- doesn't touch grants. No need to re-grant.

COMMIT;
