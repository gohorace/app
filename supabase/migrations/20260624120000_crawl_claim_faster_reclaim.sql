-- HOR-385 fix: the multi-tick drain stalled because claim_agent_crawl_job only
-- re-claimed a 'running' job after a 5-minute stale heartbeat — so consecutive
-- per-minute cron ticks couldn't advance the same job (discover set it running,
-- nothing drained it for 5 min). Drop the reclaim window to 45s (< the 60s tick
-- and the 60s Vercel maxDuration cap) so each tick continues the crawl while
-- still detecting a genuinely dead worker. Applied to prod 2026-06-24.
CREATE OR REPLACE FUNCTION public.claim_agent_crawl_job()
RETURNS SETOF public.agent_crawl_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id
      FROM agent_crawl_jobs
     WHERE status = 'pending'
        OR (status = 'running' AND heartbeat_at < now() - interval '45 seconds')
     ORDER BY enqueued_at
     LIMIT 1
       FOR UPDATE SKIP LOCKED
  )
  UPDATE agent_crawl_jobs
     SET status       = 'running',
         started_at   = COALESCE(started_at, now()),
         heartbeat_at = now()
   WHERE id IN (SELECT id FROM claimed)
   RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agent_crawl_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_agent_crawl_job() TO service_role;
