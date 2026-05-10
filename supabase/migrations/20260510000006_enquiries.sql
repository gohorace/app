-- ============================================================
-- Enquiries (HOR-63)
--
-- Structured representation of a parsed inbound email. One row per
-- inbound email that successfully parses. Linked to a contact (the
-- enquirer) and an agent (the listing agent who owns the address).
--
-- Listings are NOT modeled as a first-class table yet — listing
-- details are stored as informational fields on the enquiry. Promote
-- to a `listings` table when cross-listing reporting earns it.
-- ============================================================

CREATE TABLE enquiries (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_email_id    uuid        NOT NULL REFERENCES inbound_emails(id) ON DELETE CASCADE,
  agent_id            uuid        NOT NULL REFERENCES agents(id),
  contact_id          uuid        REFERENCES contacts(id) ON DELETE SET NULL,

  -- Listing info (informational; no FK)
  listing_external_id text,
  listing_address     text,
  listing_url         text,
  listing_agent_name  text,

  -- Enquirer info (extracted from body / reply_to)
  enquirer_name       text,
  enquirer_email      text,
  enquirer_phone      text,

  -- Free-text content
  message             text,
  intent              text,
  requested_actions   text[]      NOT NULL DEFAULT '{}',

  parsed_at           timestamptz NOT NULL DEFAULT now(),

  -- One enquiry per inbound email; replays no-op cleanly.
  UNIQUE (inbound_email_id)
);

CREATE INDEX enquiries_agent_id_idx          ON enquiries(agent_id);
CREATE INDEX enquiries_contact_id_idx        ON enquiries(contact_id);
CREATE INDEX enquiries_parsed_at_idx         ON enquiries(parsed_at DESC);
CREATE INDEX enquiries_listing_external_idx  ON enquiries(listing_external_id)
  WHERE listing_external_id IS NOT NULL;

ALTER TABLE enquiries ENABLE ROW LEVEL SECURITY;

-- Workspace-wide visibility: any workspace member sees all enquiries
-- for any agent in the workspace. Supports handoff cases.
CREATE POLICY "enquiries_select" ON enquiries
  FOR SELECT USING (
    agent_id IN (
      SELECT id FROM agents WHERE workspace_id = ANY(public.user_workspace_ids())
    )
  );

COMMENT ON TABLE enquiries IS
  'Parsed structured enquiries from inbound portal emails (HOR-63).';
