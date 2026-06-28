-- get_daily_briefing_data: additionally return identified_at so callers can
-- bucket the firing signals into familiar (resolved identity) vs anonymous
-- (activity but no name yet) at send time. Used by the "Something's stirring"
-- notification email's texture line.
--
-- Additive only: the column is appended to the result, the WHERE/ORDER/LIMIT
-- are unchanged, so the in-app Stream (/digest), which reads the same RPC,
-- keeps its existing behaviour.
CREATE OR REPLACE FUNCTION get_daily_briefing_data(p_agent_id uuid)
RETURNS TABLE (
  contact_id    uuid,
  first_name    text,
  last_name     text,
  email         text,
  score         int,
  score_change  int,
  last_seen_at  timestamptz,
  identified_at timestamptz
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id            AS contact_id,
    c.first_name,
    c.last_name,
    c.email,
    c.score,
    COALESCE(SUM(sh.delta), 0)::int AS score_change,
    c.last_seen_at,
    c.identified_at
  FROM contacts c
  LEFT JOIN score_history sh
    ON sh.contact_id = c.id
   AND sh.agent_id   = p_agent_id
   AND sh.occurred_at >= now() - interval '24 hours'
  WHERE c.agent_id = p_agent_id
  GROUP BY c.id
  HAVING COALESCE(SUM(sh.delta), 0) > 0
  ORDER BY score_change DESC, c.score DESC
  LIMIT 10;
$$;
