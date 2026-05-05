-- Migration: Add suburb to contacts + helper function for the contacts list view

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS suburb text;

COMMENT ON COLUMN contacts.suburb IS
  'The suburb where the contact lives — used for location-based signal matching.';

-- ─── get_contacts_list ────────────────────────────────────────────────────────
-- Returns all contacts for an agent with aggregated stats needed for the list UI:
-- session_count, last event type, last page title, and 7-day score change.

CREATE OR REPLACE FUNCTION get_contacts_list(p_agent_id uuid)
RETURNS TABLE (
  id               uuid,
  first_name       text,
  last_name        text,
  email            text,
  phone            text,
  score            int,
  score_change_7d  int,
  last_seen_at     timestamptz,
  property_address text,
  suburb           text,
  crm_source       text,
  session_count    bigint,
  last_event_type  text,
  last_page_title  text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH agent_contacts AS (
    SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
           c.score, c.last_seen_at, c.property_address, c.suburb, c.crm_source
    FROM contacts c
    WHERE c.agent_id = p_agent_id
  ),
  contact_sessions AS (
    SELECT
      im.contact_id,
      COUNT(DISTINCT s.id) AS session_count
    FROM identity_map im
    JOIN sessions s
      ON  s.workspace_id = im.workspace_id
      AND s.anonymous_id = im.anonymous_id
    WHERE im.contact_id IN (SELECT id FROM agent_contacts)
    GROUP BY im.contact_id
  ),
  last_page AS (
    SELECT DISTINCT ON (im.contact_id)
      im.contact_id,
      e.event_type,
      e.properties->>'title' AS page_title
    FROM identity_map im
    JOIN sessions s
      ON  s.workspace_id = im.workspace_id
      AND s.anonymous_id = im.anonymous_id
    JOIN events e ON e.session_id = s.id
    WHERE im.contact_id IN (SELECT id FROM agent_contacts)
      AND e.event_type IN ('page_view', 'property_view', 'form_submit')
    ORDER BY im.contact_id, e.occurred_at DESC
  ),
  score_7d AS (
    SELECT
      sh.contact_id,
      COALESCE(SUM(sh.delta), 0)::int AS score_change
    FROM score_history sh
    WHERE sh.agent_id   = p_agent_id
      AND sh.occurred_at >= now() - interval '7 days'
    GROUP BY sh.contact_id
  )
  SELECT
    ac.id,
    ac.first_name,
    ac.last_name,
    ac.email,
    ac.phone,
    ac.score,
    COALESCE(s7.score_change, 0)    AS score_change_7d,
    ac.last_seen_at,
    ac.property_address,
    ac.suburb,
    ac.crm_source,
    COALESCE(cs.session_count, 0)   AS session_count,
    lp.event_type                   AS last_event_type,
    lp.page_title                   AS last_page_title
  FROM agent_contacts ac
  LEFT JOIN contact_sessions cs ON cs.contact_id = ac.id
  LEFT JOIN last_page          lp ON lp.contact_id  = ac.id
  LEFT JOIN score_7d           s7 ON s7.contact_id  = ac.id
  ORDER BY ac.score DESC, cs.session_count DESC NULLS LAST
  LIMIT 500;
$$;
