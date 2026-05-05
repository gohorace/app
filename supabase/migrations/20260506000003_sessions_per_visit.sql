-- Migration: Track one session row per visit instead of one per anonymous_id.
--
-- Previously: UNIQUE(workspace_id, anonymous_id) → every visitor had one row
-- forever, so session_count was always 1.
--
-- Now: each 30-min tracker session (identified by its `sid` UUID) gets its own
-- row. We keep a plain index on (workspace_id, anonymous_id) for fast identity
-- lookups. Existing rows get their current id as the tracker_session_id so the
-- constraint can be applied cleanly.

-- 1. Add tracker_session_id column (nullable first so existing rows don't fail)
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS tracker_session_id uuid;

-- 2. Back-fill existing rows — use the row's own auto-generated id as a stand-in
UPDATE sessions
  SET tracker_session_id = id
  WHERE tracker_session_id IS NULL;

-- 3. Make it NOT NULL + add unique constraint
ALTER TABLE sessions
  ALTER COLUMN tracker_session_id SET NOT NULL;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_workspace_tracker_session_key
  UNIQUE (workspace_id, tracker_session_id);

-- 4. Drop the old unique constraint that prevented multiple sessions per visitor.
--    Keep a regular index for identity_map join performance.
ALTER TABLE sessions
  DROP CONSTRAINT IF EXISTS sessions_workspace_id_anonymous_id_key;

CREATE INDEX IF NOT EXISTS sessions_workspace_anon_idx
  ON sessions (workspace_id, anonymous_id);
