-- ============================================================
-- HOR-387 (P3) — Content matching data layer
--
--   1. agent_content_mutes — per-agent global "never insert this content type"
--      (the brief's mute). P3 owns the table + the matcher filter; P5 (HOR-389)
--      adds the toggle UI.
--   2. get_contact_signal_events — the matcher's input. Same contact-event
--      union as get_contact_events (20260519000003) but projects the TYPED
--      columns matching needs (page_type, suburb, property_id, session_id)
--      instead of the raw properties jsonb.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_content_mutes (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id     uuid NOT NULL REFERENCES agents(id)     ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('listing', 'sold', 'suburb_report')),
  muted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, agent_id, content_type)
);

ALTER TABLE agent_content_mutes ENABLE ROW LEVEL SECURITY;

-- Workspace members read; members write within their workspace (P5 UI sets the
-- caller's own agent_id). Service-role (matcher) bypasses RLS.
DROP POLICY IF EXISTS "agent_content_mutes_select" ON agent_content_mutes;
CREATE POLICY "agent_content_mutes_select" ON agent_content_mutes
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

DROP POLICY IF EXISTS "agent_content_mutes_write" ON agent_content_mutes;
CREATE POLICY "agent_content_mutes_write" ON agent_content_mutes
  FOR ALL USING (workspace_id = ANY(public.user_workspace_ids()))
  WITH CHECK (workspace_id = ANY(public.user_workspace_ids()));

-- ─── Matcher input RPC ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_contact_signal_events(p_contact_id uuid)
RETURNS TABLE (
  event_type  text,
  page_type   text,
  suburb      text,
  property_id uuid,
  session_id  uuid,
  occurred_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- Session-anchored (pre-identification history, via identity_map).
  SELECT e.event_type, e.page_type, e.suburb, e.property_id, e.session_id, e.occurred_at
  FROM identity_map im
  JOIN sessions s
    ON  s.workspace_id = im.workspace_id
    AND s.anonymous_id = im.anonymous_id
  JOIN events e
    ON  e.session_id = s.id
  WHERE im.contact_id = p_contact_id

  UNION ALL

  -- Contact-anchored (email_*, portal enquiries: session_id IS NULL).
  SELECT e.event_type, e.page_type, e.suburb, e.property_id, e.session_id, e.occurred_at
  FROM events e
  WHERE e.contact_id = p_contact_id
    AND e.session_id IS NULL

  ORDER BY occurred_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_contact_signal_events(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contact_signal_events(uuid) TO authenticated, service_role;
