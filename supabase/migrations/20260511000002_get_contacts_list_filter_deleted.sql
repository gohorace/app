-- ============================================================
-- HOR-97  Phase 2a — filter soft-deleted contacts from get_contacts_list
--
-- The list function is the dashboard's primary contact reader. Adds a
-- `WHERE c.deleted_at IS NULL` filter so soft-deleted contacts disappear
-- from list views without affecting recovery.
--
-- Other readers (lead detail page, contact API) gain the same filter at
-- the call-site in this PR. Cleanup phase eventually drops `agent_id`,
-- `crm_external_id`, etc; signature stays stable for that work.
-- ============================================================

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
      AND c.deleted_at IS NULL
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
  ORDER BY ac.score DESC, cs.session_count DESC NULLS LAST
  LIMIT 500;
$$;
