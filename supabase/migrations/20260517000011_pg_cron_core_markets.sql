-- ============================================================
-- HOR-193  Core Markets — pg_cron schedule for the import worker
--
-- Schedules a job to invoke the Next.js worker route every minute.
-- The worker (apps/web/src/app/api/cron/process-core-market-imports)
-- claims one pending core_market_imports row, processes a batch via
-- import_core_market_batch (HOR-193), and dispatches the import-
-- complete notification when done.
--
-- Architecture rationale: Vercel Hobby caps cron at 2 jobs and daily
-- minimum frequency, so this can't be a Vercel cron. pg_cron drives
-- the schedule from Postgres; pg_net fires an async HTTPS POST at the
-- Next.js route with the standard CRON_SECRET bearer. The route is
-- the same shape as the existing /api/cron/* routes — no Edge Function
-- runtime required.
--
-- ── Prereqs ──────────────────────────────────────────────────────
-- 1. pg_cron + pg_net extensions enabled in the Supabase project
--    (Dashboard → Database → Extensions). Requires superuser — can't
--    be done via app migrations.
-- 2. Two Postgres parameters set on the database (Dashboard →
--    Database → Settings → Database Settings, or via SQL):
--
--      ALTER DATABASE postgres SET app.cron_worker_url =
--        'https://gohorace.com/api/cron/process-core-market-imports';
--
--      ALTER DATABASE postgres SET app.cron_secret =
--        '<the same value as CRON_SECRET env var on Vercel>';
--
--    Both must be set BEFORE this migration applies, otherwise the
--    scheduled job will fire silently into thin air.
--
-- If either prereq is missing the migration STILL applies cleanly
-- (we don't probe), but the cron will no-op until they're in place.
-- See docs/cron-pg_cron-setup.md (TODO post-merge).
-- ============================================================

-- pg_cron and pg_net live in the `cron` and `net` schemas respectively;
-- both are created by their extensions. We just need our search_path
-- to find them while we write the schedule.
SET LOCAL search_path = public, cron, net;

-- Idempotent: drop any prior schedule with the same name before
-- re-creating. cron.unschedule(name) raises if the name doesn't
-- exist, hence the EXISTS guard.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-core-market-imports') THEN
    PERFORM cron.unschedule('process-core-market-imports');
  END IF;
END $$;

-- Every minute. pg_net.http_post is async — returns a request_id and
-- the HTTPS call happens in the background, so the cron tick itself
-- is sub-millisecond. The actual import work happens inside the
-- Next.js route, which has up to 60s on Vercel Hobby (the route sets
-- maxDuration to make this explicit).
SELECT cron.schedule(
  'process-core-market-imports',
  '* * * * *',
  $cron$
    SELECT net.http_post(
      url := current_setting('app.cron_worker_url', true),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.cron_secret', true),
        'Content-Type',  'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 5000
    );
  $cron$
);

COMMENT ON EXTENSION pg_cron IS
  'HOR-193: drives the Core Markets import worker via /api/cron/process-core-market-imports every minute. Also a candidate to replace the Vercel-cron-based daily-briefing and purge-soft-deleted jobs once HOR-200 lands.';
