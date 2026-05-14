-- ============================================================
-- HOR-192  Core Markets — async import queue (2 of 7)
--
-- One row per "import this locality into this agent's workspace"
-- job. Inserted by POST /api/core-markets (HOR-193) at the same
-- transaction as the parent core_markets row.
--
-- Drained by the Supabase Edge Function worker
-- supabase/functions/process-core-market-imports (HOR-193), which is
-- invoked every minute by pg_cron + pg_net (Vercel Hobby caps cron
-- at 2 daily, so the worker isn't a Vercel route — see memory note
-- horace_cron_pg_cron.md).
--
-- batch_cursor pages through gnaf.address_principal ordered by
-- address_detail_pid (cheap given the locality_paging composite
-- index from 20260517000001). The worker processes ~2000 rows per
-- tick; rows_imported/rows_matched accumulate across ticks.
--
-- heartbeat_at lets the worker re-claim a job whose previous tick
-- crashed mid-batch: the claim RPC (A9) treats `status='running' AND
-- heartbeat_at < now() - interval '5 minutes'` as eligible for
-- re-claim.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS core_market_imports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  core_market_id  uuid NOT NULL REFERENCES core_markets(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id)   ON DELETE CASCADE,
  agent_id        uuid NOT NULL REFERENCES agents(id)       ON DELETE CASCADE,
  locality_pid    text NOT NULL REFERENCES gnaf.localities(locality_pid),
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'complete', 'error')),
  -- Last gnaf.address_principal.address_detail_pid processed.
  -- NULL = haven't started; advance with each batch.
  batch_cursor    text,
  rows_imported   integer NOT NULL DEFAULT 0,
  rows_matched    integer NOT NULL DEFAULT 0,
  error_message   text,
  enqueued_at     timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  -- Last heartbeat from the worker. Updated each batch. Stuck-job
  -- detection: any 'running' row with heartbeat_at older than 5 min
  -- is re-claimable.
  heartbeat_at    timestamptz
);

-- Cron-hot index: claim path filters to pending/running ordered by
-- enqueue time. Partial keeps it tiny — most rows are 'complete'.
CREATE INDEX IF NOT EXISTS core_market_imports_status_idx
  ON core_market_imports (status, enqueued_at)
  WHERE status IN ('pending', 'running');

-- "Show me my recent imports" — Settings UI surface (latest status
-- per market).
CREATE INDEX IF NOT EXISTS core_market_imports_agent_idx
  ON core_market_imports (agent_id, enqueued_at DESC);

-- Worker-side: looking up the latest import for a given core_market
-- when re-enqueuing or surfacing status. Single column index suffices.
CREATE INDEX IF NOT EXISTS core_market_imports_core_market_idx
  ON core_market_imports (core_market_id, enqueued_at DESC);

ALTER TABLE core_market_imports ENABLE ROW LEVEL SECURITY;

-- Workspace members can read; writes go via admin client + the
-- claim RPC (A9, SECURITY DEFINER bypasses RLS).
DROP POLICY IF EXISTS "core_market_imports_select" ON core_market_imports;
CREATE POLICY "core_market_imports_select" ON core_market_imports
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

COMMENT ON TABLE core_market_imports IS
  'HOR-189: async import queue. One row per core_markets enqueue. Drained by the Supabase Edge Function worker (HOR-193) invoked every minute by pg_cron. Status transitions: pending → running → complete | error. Stuck-running re-claim threshold: heartbeat_at older than 5 minutes.';
COMMENT ON COLUMN core_market_imports.batch_cursor IS
  'Last gnaf.address_principal.address_detail_pid processed in this job. NULL = haven''t started. The worker pages forward by 2000 rows per tick using the gnaf locality_paging index.';
COMMENT ON COLUMN core_market_imports.heartbeat_at IS
  'Updated each batch tick. Worker treats `status=running AND heartbeat_at < now() - interval ''5 minutes''` as a stalled job and re-claims it (see claim_core_market_import RPC).';

COMMIT;
