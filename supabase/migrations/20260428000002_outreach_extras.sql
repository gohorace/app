-- ============================================================
-- Migration 010: Outreach extras
-- Adds the data the MCP outreach tools depend on:
--   - contacts.unsubscribed_at  (Spam Act / opt-out)
--   - outreach_log              (every send, for dedup + reporting)
--   - short_links               (Horace-hosted /r/{code} redirects)
--   - contact_notes             (manual notes from MCP/UI)
-- ============================================================

-- ============================================================
-- contacts.unsubscribed_at
-- ============================================================

ALTER TABLE contacts ADD COLUMN unsubscribed_at timestamptz;

CREATE INDEX contacts_agent_unsubscribed_idx
  ON contacts(agent_id)
  WHERE unsubscribed_at IS NULL;

-- ============================================================
-- OUTREACH LOG
-- One row per outbound message attributed to a contact.
-- Channel covers email (sent via the user's own email MCP) and
-- sms (sent server-side via Twilio).
-- ============================================================

CREATE TABLE outreach_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid NOT NULL REFERENCES agents(id)     ON DELETE CASCADE,
  contact_id      uuid NOT NULL REFERENCES contacts(id)   ON DELETE CASCADE,
  campaign_id     uuid          REFERENCES campaigns(id)  ON DELETE SET NULL,
  channel         text NOT NULL CHECK (channel IN ('email', 'sms')),
  subject         text,
  message_preview text,
  external_id     text,
  source          text NOT NULL DEFAULT 'mcp'
                    CHECK (source IN ('mcp', 'ui', 'auto')),
  sent_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outreach_log_agent_sent_idx
  ON outreach_log(agent_id, sent_at DESC);

CREATE INDEX outreach_log_contact_sent_idx
  ON outreach_log(contact_id, sent_at DESC);

ALTER TABLE outreach_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outreach_log_all" ON outreach_log
  USING     (agent_id = ANY(public.user_agent_ids()))
  WITH CHECK (agent_id = ANY(public.user_agent_ids()));

-- ============================================================
-- SHORT LINKS
-- Horace-hosted /r/{code} redirects. When contact_id is set, the
-- redirect appends the campaign_token query param so the tracker
-- can stitch identity on click.
-- ============================================================

CREATE TABLE short_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid NOT NULL REFERENCES agents(id)     ON DELETE CASCADE,
  contact_id      uuid          REFERENCES contacts(id)   ON DELETE SET NULL,
  campaign_id     uuid          REFERENCES campaigns(id)  ON DELETE SET NULL,
  code            text NOT NULL UNIQUE,
  target_url      text NOT NULL,
  click_count     int NOT NULL DEFAULT 0,
  last_clicked_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX short_links_agent_idx ON short_links(agent_id);
CREATE INDEX short_links_code_idx  ON short_links(code);

ALTER TABLE short_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "short_links_all" ON short_links
  USING     (agent_id = ANY(public.user_agent_ids()))
  WITH CHECK (agent_id = ANY(public.user_agent_ids()));

-- ============================================================
-- CONTACT NOTES
-- Free-form notes attached to a contact, e.g. call summaries
-- recorded via the MCP "log_note" tool.
-- ============================================================

CREATE TABLE contact_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   uuid NOT NULL REFERENCES agents(id)   ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  body       text NOT NULL,
  source     text NOT NULL DEFAULT 'mcp'
              CHECK (source IN ('mcp', 'ui', 'import')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contact_notes_contact_created_idx
  ON contact_notes(contact_id, created_at DESC);

ALTER TABLE contact_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contact_notes_all" ON contact_notes
  USING     (agent_id = ANY(public.user_agent_ids()))
  WITH CHECK (agent_id = ANY(public.user_agent_ids()));

-- ============================================================
-- FUNCTION: Atomic short-link click increment.
-- Returns the link's target details for the redirect handler.
-- ============================================================

CREATE OR REPLACE FUNCTION click_short_link(p_code text)
RETURNS TABLE (
  agent_id     uuid,
  contact_id   uuid,
  campaign_id  uuid,
  target_url   text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE short_links
  SET    click_count     = click_count + 1,
         last_clicked_at = now()
  WHERE  code = p_code
  RETURNING short_links.agent_id,
            short_links.contact_id,
            short_links.campaign_id,
            short_links.target_url;
END;
$$;
