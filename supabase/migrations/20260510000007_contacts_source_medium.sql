-- ============================================================
-- Contacts: crm_source → source + medium (HOR-63 Phase 1c)
--
-- Replaces the single crm_source enum with a UTM-style
-- (source, medium) pair to model both the kind of capture surface
-- and the specific provider within it.
--
-- Mapping:
--   crm_source = 'rex'       → source='crm',     medium='rex'
--   crm_source = 'agentbox'  → source='crm',     medium='agentbox'
--   crm_source = 'website'   → source='website', medium=NULL
--                            (or source='portal', medium=<portal>
--                             if the contact has a linked enquiry)
--   crm_source = 'manual'/NULL → source='manual', medium=NULL
--
-- Also redefines get_contacts_list to return source + medium
-- instead of crm_source.
-- ============================================================

-- 1. Add columns (NULL allowed initially so backfill can run).
ALTER TABLE contacts
  ADD COLUMN source text,
  ADD COLUMN medium text;

-- 2. Backfill base mapping from crm_source.
UPDATE contacts
SET
  source = CASE
    WHEN crm_source IN ('rex', 'agentbox') THEN 'crm'
    WHEN crm_source = 'website'             THEN 'website'
    ELSE 'manual'
  END,
  medium = CASE
    WHEN crm_source IN ('rex', 'agentbox') THEN crm_source
    ELSE NULL
  END;

-- 3. Promote portal-sourced contacts. HOR-63 Phase 1b created these
-- with crm_source='website' as a stop-gap; now that the linkage
-- exists, attribute them to (portal, <source_portal>).
UPDATE contacts c
SET source = 'portal',
    medium = ie.source_portal
FROM enquiries e
JOIN inbound_emails ie ON ie.id = e.inbound_email_id
WHERE c.id = e.contact_id
  AND ie.source_portal IS NOT NULL;

-- 4. Lock down `source`. medium remains nullable.
ALTER TABLE contacts ALTER COLUMN source SET NOT NULL;
ALTER TABLE contacts ALTER COLUMN source SET DEFAULT 'manual';

ALTER TABLE contacts
  ADD CONSTRAINT contacts_source_check
  CHECK (source IN ('portal', 'crm', 'website', 'manual'));

-- 5. Redefine get_contacts_list to return source + medium.
-- Must redefine BEFORE dropping crm_source, since the existing
-- function body references it.
DROP FUNCTION IF EXISTS get_contacts_list(uuid);

CREATE OR REPLACE FUNCTION get_contacts_list(p_agent_id uuid)
RETURNS TABLE (
  id                              uuid,
  first_name                      text,
  last_name                       text,
  email                           text,
  phone                           text,
  score                           int,
  score_change_7d                 int,
  last_seen_at                    timestamptz,
  property_address                text,
  suburb                          text,
  source                          text,
  medium                          text,
  session_count                   bigint,
  last_event_type                 text,
  last_page_title                 text,
  tracked_link_token              text,
  tracked_link_last_clicked_at    timestamptz,
  tracked_link_destination_url    text,
  is_stitched                     boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH agent_contacts AS (
    SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
           c.score, c.last_seen_at, c.property_address, c.suburb,
           c.source, c.medium
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
  ),
  stitched AS (
    SELECT DISTINCT im.contact_id
    FROM identity_map im
    WHERE im.agent_id = p_agent_id
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
    ac.source,
    ac.medium,
    COALESCE(cs.session_count, 0)   AS session_count,
    lp.event_type                   AS last_event_type,
    lp.page_title                   AS last_page_title,
    ctl.token                       AS tracked_link_token,
    ctl.last_clicked_at             AS tracked_link_last_clicked_at,
    ctl.destination_url             AS tracked_link_destination_url,
    (st.contact_id IS NOT NULL)     AS is_stitched
  FROM agent_contacts ac
  LEFT JOIN contact_sessions      cs  ON cs.contact_id  = ac.id
  LEFT JOIN last_page             lp  ON lp.contact_id  = ac.id
  LEFT JOIN score_7d              s7  ON s7.contact_id  = ac.id
  LEFT JOIN contact_tracked_links ctl ON ctl.contact_id = ac.id
  LEFT JOIN stitched              st  ON st.contact_id  = ac.id
$$;

-- 6. Now safe to drop the old column + its check constraint.
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_crm_source_check;
ALTER TABLE contacts DROP COLUMN crm_source;

CREATE INDEX IF NOT EXISTS contacts_source_idx ON contacts(source);
CREATE INDEX IF NOT EXISTS contacts_medium_idx ON contacts(medium) WHERE medium IS NOT NULL;
