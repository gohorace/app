-- ============================================================
-- HOR-77  Activity feed — extend notification_log for user display
--
-- The brief calls for a permanent in-app activity feed. Rather than
-- duplicate writes into a separate table, extend notification_log so
-- each row carries the display copy that was shown to the agent at the
-- time. The audit/dedup behaviour is unchanged; the new columns are
-- nullable so existing rows and non-displayable types (e.g.
-- 'volume_review') stay untouched and don't appear in the feed.
-- ============================================================

BEGIN;

ALTER TABLE notification_log
  ADD COLUMN IF NOT EXISTS title        text,
  ADD COLUMN IF NOT EXISTS body         text,
  ADD COLUMN IF NOT EXISTS url          text,
  ADD COLUMN IF NOT EXISTS read_at      timestamptz,
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;

-- Backfill workspace_id from the agent for any historic rows
UPDATE notification_log nl
SET workspace_id = a.workspace_id
FROM agents a
WHERE nl.agent_id = a.id
  AND nl.workspace_id IS NULL
  AND a.workspace_id IS NOT NULL;

-- Auto-fill workspace_id on insert so every call site doesn't have to
-- look it up. Trigger only writes when workspace_id is NULL on insert.
CREATE OR REPLACE FUNCTION set_notification_log_workspace_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.workspace_id IS NULL THEN
    SELECT workspace_id INTO NEW.workspace_id
    FROM agents
    WHERE id = NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notification_log_set_workspace_id ON notification_log;
CREATE TRIGGER notification_log_set_workspace_id
  BEFORE INSERT ON notification_log
  FOR EACH ROW EXECUTE FUNCTION set_notification_log_workspace_id();

-- Index supporting the feed query: chronological per agent, only rows
-- that have user-visible display copy (excludes 'volume_review' etc.)
CREATE INDEX IF NOT EXISTS notification_log_feed_idx
  ON notification_log(agent_id, sent_at DESC)
  WHERE title IS NOT NULL;

-- Index supporting the unread-count badge.
CREATE INDEX IF NOT EXISTS notification_log_unread_idx
  ON notification_log(agent_id)
  WHERE read_at IS NULL AND title IS NOT NULL;

COMMIT;
