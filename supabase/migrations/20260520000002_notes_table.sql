-- ============================================================
-- HOR-252 / HOR-241 — Notes (threaded, @mentionable comment log)
--
-- v2 replaces the single-textarea NotesPanel (contacts.notes /
-- properties.metadata.notes) with a NotesThread: a workspace-visible
-- comment feed against a contact OR a property, with @mention of
-- teammates. Positioning: this is a team coordination log, not CRM
-- deal-tracking (Andy signed off on the CLAUDE.md rule-2 tension).
--
-- Exactly one of contact_id / property_id is set per row.
--
-- ⚠️ Migration drift active (HOR-131): apply via Supabase Studio SQL
--    editor + manual
--      INSERT INTO supabase_migrations.schema_migrations
--        (version) VALUES ('20260520000002');
--    Do NOT `supabase db push`.
-- ============================================================

BEGIN;

CREATE TABLE notes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author_id    uuid        NOT NULL REFERENCES agents(id)     ON DELETE CASCADE,
  body         text        NOT NULL,
  -- Resolved agent ids extracted from @<agent-id> tokens at insert time.
  mentions     uuid[]      NOT NULL DEFAULT '{}',
  contact_id   uuid        REFERENCES contacts(id)   ON DELETE CASCADE,
  property_id  uuid        REFERENCES properties(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  edited_at    timestamptz,
  resolved     boolean     NOT NULL DEFAULT false,
  -- Exactly one subject.
  CONSTRAINT notes_one_subject CHECK (
    (contact_id IS NOT NULL AND property_id IS NULL) OR
    (contact_id IS NULL AND property_id IS NOT NULL)
  )
);

CREATE INDEX notes_contact_idx   ON notes (contact_id, created_at DESC) WHERE contact_id IS NOT NULL;
CREATE INDEX notes_property_idx  ON notes (property_id, created_at DESC) WHERE property_id IS NOT NULL;
CREATE INDEX notes_workspace_idx ON notes (workspace_id);

DROP TRIGGER IF EXISTS notes_updated_at ON notes;

-- ============================================================
-- RLS: workspace members read all notes in their workspace; an agent
-- writes/edits/deletes only their own rows.
-- ============================================================

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY notes_workspace_read
  ON notes FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM agents WHERE user_id = auth.uid()));

CREATE POLICY notes_author_insert
  ON notes FOR INSERT TO authenticated
  WITH CHECK (author_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

CREATE POLICY notes_author_update
  ON notes FOR UPDATE TO authenticated
  USING (author_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

CREATE POLICY notes_author_delete
  ON notes FOR DELETE TO authenticated
  USING (author_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON notes TO authenticated;

-- ============================================================
-- Backfill from the v1 single-textarea notes. Don't clear the source
-- columns here — leave them as a read-only fallback for one cycle
-- (a later cleanup ticket drops them).
--
--   contacts.metadata->>'notes'   — author = the contact's owning agent.
--     (Verified: there is NO top-level contacts.notes column — notes are
--     stored in the metadata JSONB, mirroring properties. The generated
--     types claim a `notes` column but no migration ever added it; see
--     api/contacts/[id]/route.ts.)
--   properties.metadata->>'notes' — author = workspace default agent
--                           (properties are workspace-scoped, not
--                           agent-owned). Skip workspaces with no
--                           default_agent_id.
-- ============================================================

INSERT INTO notes (workspace_id, author_id, body, contact_id, created_at)
SELECT c.workspace_id, c.agent_id, c.metadata->>'notes', c.id, now()
FROM contacts c
WHERE coalesce(c.metadata->>'notes', '') <> ''
  AND c.agent_id IS NOT NULL
  AND c.workspace_id IS NOT NULL
  AND c.deleted_at IS NULL;

INSERT INTO notes (workspace_id, author_id, body, property_id, created_at)
SELECT p.workspace_id, w.default_agent_id, p.metadata->>'notes', p.id, now()
FROM properties p
JOIN workspaces w ON w.id = p.workspace_id
WHERE coalesce(p.metadata->>'notes', '') <> ''
  AND w.default_agent_id IS NOT NULL
  AND p.deleted_at IS NULL;

COMMIT;
