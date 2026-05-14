-- HOR-142  Lists v1 Slice 1 — schema for saved + manual contact lists
--
-- Two tables introduce workspace-scoped contact lists:
--
--   • lists                       — the named bucket (manual or saved_filter)
--   • contact_list_membership     — join row per contact ∈ list
--
-- Dynamic built-in lists ("Warming up" / "Watch closely") are NOT stored;
-- they're computed at query time from contacts.score in HOR-144. The `kind`
-- column on lists carries 'manual' (added one-by-one) or 'saved_filter'
-- (Slice 2 captures the current grid filter state into filter_state JSONB).
--
-- RLS follows the workspace_invites pattern (20260512000001):
--   • SELECT: workspace members via public.user_workspace_ids()
--   • INSERT/UPDATE/DELETE: same workspace scope; ownership is workspace-wide
--     (lists are shared inside a workspace). agent_id records the creator
--     for "last touched by" affordances later — it doesn't gate access.
--
-- See HOR-141 (parent epic) for full slice plan.

BEGIN;

-- ============================================================
-- A. Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS lists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id      uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  kind          text NOT NULL DEFAULT 'manual'
    CHECK (kind IN ('manual', 'saved_filter')),
  -- filter_state is null for 'manual' lists. For 'saved_filter' it captures
  -- whatever the Contacts grid serialised (HOR-143). Shape is intentionally
  -- loose so we can extend without a migration.
  filter_state  jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE IF NOT EXISTS contact_list_membership (
  list_id            uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  contact_id         uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  added_at           timestamptz NOT NULL DEFAULT now(),
  added_by_agent_id  uuid REFERENCES agents(id) ON DELETE SET NULL,
  PRIMARY KEY (list_id, contact_id)
);

-- ============================================================
-- B. Indexes
-- ============================================================

-- Allow renaming a list to a name that previously belonged to a soft-deleted
-- list. Partial unique index = "one live list with this name per workspace".
CREATE UNIQUE INDEX IF NOT EXISTS lists_workspace_name_alive_uidx
  ON lists (workspace_id, name)
  WHERE deleted_at IS NULL;

-- Overview-page query path: list workspace's lists, newest first.
CREATE INDEX IF NOT EXISTS lists_workspace_alive_idx
  ON lists (workspace_id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- Reverse lookup: "what lists is this contact on?". Hot for contact detail
-- pages once we show list-membership chips.
CREATE INDEX IF NOT EXISTS contact_list_membership_contact_idx
  ON contact_list_membership (contact_id);

-- ============================================================
-- C. Trigger — reuse set_updated_at() from 20260408000003_scoring_functions_v2.sql
-- ============================================================

DROP TRIGGER IF EXISTS lists_updated_at ON lists;
CREATE TRIGGER lists_updated_at
  BEFORE UPDATE ON lists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- D. RLS
-- ============================================================

ALTER TABLE lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_list_membership ENABLE ROW LEVEL SECURITY;

-- Lists are workspace-shared. Every workspace member can read, create, and
-- mutate any list in the workspace. Phase 4 may tighten with per-agent
-- ownership; for V1 the surface area is small enough that shared works.

DROP POLICY IF EXISTS "lists_select" ON lists;
CREATE POLICY "lists_select" ON lists
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

DROP POLICY IF EXISTS "lists_insert" ON lists;
CREATE POLICY "lists_insert" ON lists
  FOR INSERT WITH CHECK (workspace_id = ANY(public.user_workspace_ids()));

DROP POLICY IF EXISTS "lists_update" ON lists;
CREATE POLICY "lists_update" ON lists
  FOR UPDATE USING (workspace_id = ANY(public.user_workspace_ids()));

DROP POLICY IF EXISTS "lists_delete" ON lists;
CREATE POLICY "lists_delete" ON lists
  FOR DELETE USING (workspace_id = ANY(public.user_workspace_ids()));

-- Membership rows derive their visibility from the parent list. We re-check
-- against the workspace to avoid an EXISTS subquery on every read; the
-- list_id FK guarantees the row can't exist without a live list to point at.
DROP POLICY IF EXISTS "contact_list_membership_select" ON contact_list_membership;
CREATE POLICY "contact_list_membership_select" ON contact_list_membership
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM lists l
      WHERE l.id = contact_list_membership.list_id
        AND l.workspace_id = ANY(public.user_workspace_ids())
    )
  );

DROP POLICY IF EXISTS "contact_list_membership_insert" ON contact_list_membership;
CREATE POLICY "contact_list_membership_insert" ON contact_list_membership
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM lists l
      WHERE l.id = contact_list_membership.list_id
        AND l.workspace_id = ANY(public.user_workspace_ids())
        AND l.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "contact_list_membership_delete" ON contact_list_membership;
CREATE POLICY "contact_list_membership_delete" ON contact_list_membership
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM lists l
      WHERE l.id = contact_list_membership.list_id
        AND l.workspace_id = ANY(public.user_workspace_ids())
    )
  );

-- ============================================================
-- E. Comments
-- ============================================================

COMMENT ON TABLE lists IS
  'Named contact lists, scoped to a workspace. kind=manual is the everyday "Add to list" affordance; kind=saved_filter persists a Contacts-grid filter state. Dynamic built-in lists ("Warming up"/"Watch closely") are computed from contacts.score at query time and have no row here. See HOR-141.';
COMMENT ON COLUMN lists.kind IS
  'manual: members added one-by-one. saved_filter: members are the rows matching filter_state at view time. Slice 2 (HOR-143) writes saved_filter rows; Slice 3 (HOR-144) renders the overview.';
COMMENT ON COLUMN lists.filter_state IS
  'JSONB shape of the Contacts-grid filter at save time. Null for manual lists. Loose shape so we can extend without a migration; consumers tolerate missing keys.';
COMMENT ON COLUMN lists.agent_id IS
  'Creator. Recorded for "last touched by" UX. Does NOT gate access — RLS is workspace-wide.';

COMMENT ON TABLE contact_list_membership IS
  'Join row connecting a contact to a manual list. Saved-filter lists do not store memberships here — their members are derived from the filter at read time. See HOR-141.';
COMMENT ON COLUMN contact_list_membership.added_by_agent_id IS
  'Workspace member who added this contact to this list. Set NULL on agent deletion so audit history survives.';

COMMIT;
