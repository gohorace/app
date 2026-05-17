-- ============================================================
-- HOR-192  Core Markets — worker job-claim RPC (7 of 7)
--
-- claim_core_market_import() is the single-row claim path used by
-- the Supabase Edge Function worker
-- (supabase/functions/process-core-market-imports, HOR-193) on
-- every pg_cron tick.
--
-- Originally specced in HOR-193's plan, moved into HOR-192 so all
-- DB-side objects land in one schema PR.
--
-- Eligibility — either:
--   • status='pending' (newly enqueued), OR
--   • status='running' AND heartbeat_at < now() - interval '5 min'
--     (previous worker died mid-batch; we re-claim and continue).
--
-- Concurrency:
--   • Single-row claim per call (LIMIT 1) — keeps each tick small
--     and bounded. Worker calls this once per invocation and either
--     processes the returned job or no-ops.
--   • FOR UPDATE SKIP LOCKED — if two workers somehow run
--     simultaneously, they'll claim different rows, never the same.
--
-- The UPDATE wrapping the SELECT atomically flips status to
-- 'running' and bumps heartbeat_at, so the next claim call won't
-- pick up the same row unless its heartbeat goes stale.
--
-- SECURITY DEFINER + EXECUTE granted to service_role only. The Edge
-- Function uses the service-role key to invoke this RPC.
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_core_market_import()
RETURNS SETOF public.core_market_imports
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id
      FROM core_market_imports
     WHERE status = 'pending'
        OR (status = 'running' AND heartbeat_at < now() - interval '5 minutes')
     ORDER BY enqueued_at
     LIMIT 1
       FOR UPDATE SKIP LOCKED
  )
  UPDATE core_market_imports
     SET status       = 'running',
         started_at   = COALESCE(started_at, now()),
         heartbeat_at = now()
   WHERE id IN (SELECT id FROM claimed)
   RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_core_market_import() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_core_market_import() TO service_role;

COMMENT ON FUNCTION public.claim_core_market_import() IS
  'HOR-192: Edge Function worker claim path. Returns at most one core_market_imports row, flipped from pending/stale-running to running with a fresh heartbeat. FOR UPDATE SKIP LOCKED makes the claim safe under concurrent worker invocations. Service-role-only.';
