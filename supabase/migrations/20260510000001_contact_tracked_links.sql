-- ============================================================
-- Migration: Per-contact tracked links + stitch history
--
-- Adds:
--   - contact_tracked_links: one permanent token per contact, optional
--     destination override, click counter.
--   - identity_stitch_history: audit row written whenever an
--     anonymous_id's existing identity_map.contact_id is overwritten.
--   - resolve_contact_link_click(token): used by /c/{token}, bumps
--     click_count + last_clicked_at, returns destination.
--   - stitch_contact_from_token(token, workspace_id, anonymous_id):
--     used by /api/t when the tracker forwards a campaign token from
--     the URL. Last-write-wins on identity_map; logs overrides.
--   - Trigger to auto-create a tracked-link row when a contact is
--     created. Backfills rows for all existing contacts.
--   - get_contacts_list extended with tracked_link_token,
--     tracked_link_last_clicked_at, tracked_link_destination_url,
--     is_stitched.
--
-- Reuses agent_settings.website_url as the default destination — no
-- new settings column.
-- ============================================================

-- ─── tables ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contact_tracked_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id         uuid NOT NULL REFERENCES agents(id)     ON DELETE CASCADE,
  contact_id       uuid NOT NULL REFERENCES contacts(id)   ON DELETE CASCADE,
  token            text NOT NULL,
  destination_url  text,
  click_count      int  NOT NULL DEFAULT 0,
  last_clicked_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id),
  UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS contact_tracked_links_agent_id_idx
  ON contact_tracked_links(agent_id);

COMMENT ON TABLE contact_tracked_links IS
  'One permanent tracking link per contact. Token is opaque, 12 chars, URL-safe.';
COMMENT ON COLUMN contact_tracked_links.destination_url IS
  'Per-contact override. NULL means fall back to agent_settings.website_url.';

CREATE TABLE IF NOT EXISTS identity_stitch_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id         uuid NOT NULL REFERENCES agents(id)     ON DELETE CASCADE,
  anonymous_id     text NOT NULL,
  prev_contact_id  uuid REFERENCES contacts(id) ON DELETE SET NULL,
  new_contact_id   uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  stitch_method    text NOT NULL,
  stitched_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS identity_stitch_history_agent_idx
  ON identity_stitch_history(agent_id, stitched_at DESC);

COMMENT ON TABLE identity_stitch_history IS
  'Audit log of identity_map overrides — when a cookie was previously stitched to a different contact.';

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE contact_tracked_links     ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_stitch_history   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contact_tracked_links_all" ON contact_tracked_links
  FOR ALL TO authenticated
  USING      (agent_id = ANY(public.user_agent_ids()))
  WITH CHECK (agent_id = ANY(public.user_agent_ids()));

CREATE POLICY "identity_stitch_history_select" ON identity_stitch_history
  FOR SELECT TO authenticated
  USING (agent_id = ANY(public.user_agent_ids()));

-- ─── Token generator ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION generate_tracked_link_token()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_token text;
BEGIN
  -- 12 URL-safe chars from 9 random bytes (base64-ish, '+/=' replaced)
  v_token := substring(encode(gen_random_bytes(9), 'base64') FROM 1 FOR 12);
  v_token := replace(replace(replace(v_token, '+', 'A'), '/', 'B'), '=', 'C');
  RETURN v_token;
END;
$$;

-- ─── Trigger: auto-create tracked link on contact insert ──────────────────────

CREATE OR REPLACE FUNCTION trg_ensure_contact_tracked_link()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_workspace_id uuid;
  v_token        text;
  v_attempts     int := 0;
BEGIN
  SELECT a.workspace_id INTO v_workspace_id
  FROM agents a WHERE a.id = NEW.agent_id;

  IF v_workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Retry on the (very unlikely) UNIQUE collision
  LOOP
    v_token := generate_tracked_link_token();
    BEGIN
      INSERT INTO contact_tracked_links (workspace_id, agent_id, contact_id, token)
      VALUES (v_workspace_id, NEW.agent_id, NEW.id, v_token);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_attempts := v_attempts + 1;
      IF v_attempts > 5 THEN RAISE; END IF;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_tracked_link_insert ON contacts;
CREATE TRIGGER contacts_tracked_link_insert
  AFTER INSERT ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION trg_ensure_contact_tracked_link();

-- ─── Backfill: one tracked link per existing contact ──────────────────────────

INSERT INTO contact_tracked_links (workspace_id, agent_id, contact_id, token)
SELECT
  a.workspace_id,
  c.agent_id,
  c.id,
  generate_tracked_link_token()
FROM contacts c
JOIN agents   a ON a.id = c.agent_id
WHERE a.workspace_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM contact_tracked_links ctl WHERE ctl.contact_id = c.id
  );

-- ─── RPC: click handler resolution ────────────────────────────────────────────
-- Called by /c/{token}. Bumps click counters, returns destination data.
-- Stitching does NOT happen here (cross-domain — no anonymous_id available).
-- Returns NULL row when token doesn't exist.

CREATE OR REPLACE FUNCTION resolve_contact_link_click(p_token text)
RETURNS TABLE (
  contact_id       uuid,
  agent_id         uuid,
  workspace_id     uuid,
  destination_url  text,
  default_url      text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH bumped AS (
    UPDATE contact_tracked_links ctl
       SET click_count     = ctl.click_count + 1,
           last_clicked_at = now()
     WHERE ctl.token = p_token
     RETURNING
       ctl.contact_id, ctl.agent_id, ctl.workspace_id, ctl.destination_url
  )
  SELECT
    b.contact_id,
    b.agent_id,
    b.workspace_id,
    b.destination_url,
    s.website_url AS default_url
  FROM bumped b
  LEFT JOIN agent_settings s ON s.agent_id = b.agent_id;
END;
$$;

-- ─── RPC: stitch on tracker beacon ────────────────────────────────────────────
-- Called by /api/t when the tracker forwards `s.ctoken`. Writes the
-- identity_map row (last-write-wins) and logs an override row to
-- identity_stitch_history when a different contact was previously stitched
-- to this anonymous_id.

CREATE OR REPLACE FUNCTION stitch_contact_from_token(
  p_token        text,
  p_workspace_id uuid,
  p_anonymous_id text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_contact_id   uuid;
  v_agent_id     uuid;
  v_link_ws      uuid;
  v_prev_contact uuid;
BEGIN
  IF p_token IS NULL OR p_anonymous_id IS NULL OR p_workspace_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ctl.contact_id, ctl.agent_id, ctl.workspace_id
    INTO v_contact_id, v_agent_id, v_link_ws
    FROM contact_tracked_links ctl
   WHERE ctl.token = p_token;

  IF v_contact_id IS NULL THEN RETURN NULL; END IF;

  -- The tracker beacon must originate from the same workspace that owns
  -- the link — guards against tokens being replayed across workspaces.
  IF v_link_ws <> p_workspace_id THEN RETURN NULL; END IF;

  -- Existing stitch for this cookie?
  SELECT im.contact_id INTO v_prev_contact
    FROM identity_map im
   WHERE im.workspace_id = p_workspace_id
     AND im.agent_id     = v_agent_id
     AND im.anonymous_id = p_anonymous_id;

  -- Log the override only when we're switching to a different contact
  IF v_prev_contact IS NOT NULL AND v_prev_contact <> v_contact_id THEN
    INSERT INTO identity_stitch_history
      (workspace_id, agent_id, anonymous_id, prev_contact_id, new_contact_id, stitch_method)
    VALUES
      (p_workspace_id, v_agent_id, p_anonymous_id, v_prev_contact, v_contact_id, 'email_click');
  END IF;

  -- Last-write-wins
  INSERT INTO identity_map
    (workspace_id, agent_id, anonymous_id, contact_id, stitch_method, confidence)
  VALUES
    (p_workspace_id, v_agent_id, p_anonymous_id, v_contact_id, 'email_click', 'high')
  ON CONFLICT (workspace_id, agent_id, anonymous_id) DO UPDATE
    SET contact_id    = EXCLUDED.contact_id,
        stitch_method = EXCLUDED.stitch_method,
        confidence    = EXCLUDED.confidence;

  RETURN v_contact_id;
END;
$$;

-- ─── Extend get_contacts_list ─────────────────────────────────────────────────
-- DROP first because we're adding columns to RETURNS TABLE; CREATE OR REPLACE
-- cannot change the return shape.

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
  crm_source                      text,
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
    ac.crm_source,
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
