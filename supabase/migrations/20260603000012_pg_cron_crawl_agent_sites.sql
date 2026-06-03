-- ============================================================
-- HOR-385 (P1) — pg_cron schedules for the site crawler
--
-- Mirrors the Core Markets schedule (20260517000011): Vercel Hobby caps cron
-- at 2 daily jobs, so background work runs via pg_cron + pg_net hitting a
-- Next.js route. Two jobs:
--
--   1. crawl-agent-sites    — every minute, drains one claimed crawl job a
--                             tick (net.http_get the worker route).
--   2. enqueue-nightly-crawls — once a day (04:30 UTC ≈ early-morning AEST),
--                             enqueues a nightly crawl per agent. Pure SQL,
--                             no HTTP — calls enqueue_nightly_crawls() in-DB.
--
-- PREREQUISITE — create the worker-URL vault secret once in the Dashboard
-- (the shared 'cron_secret' already exists from Core Markets):
--
--   SELECT vault.create_secret(
--     'https://gohorace.com/api/cron/crawl-agent-sites',
--     'crawl_worker_url',
--     'Site crawler worker URL — HOR-385'
--   );
-- ============================================================

-- 1. Per-minute worker tick.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crawl-agent-sites') THEN
    PERFORM cron.unschedule('crawl-agent-sites');
  END IF;
END $$;

SELECT cron.schedule(
  'crawl-agent-sites',
  '* * * * *',
  $cron$
    SELECT net.http_get(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'crawl_worker_url'),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
      ),
      timeout_milliseconds := 5000
    );
  $cron$
);

-- 2. Nightly enqueue — pure in-DB, no HTTP needed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'enqueue-nightly-crawls') THEN
    PERFORM cron.unschedule('enqueue-nightly-crawls');
  END IF;
END $$;

SELECT cron.schedule(
  'enqueue-nightly-crawls',
  '30 4 * * *',
  $cron$ SELECT public.enqueue_nightly_crawls(); $cron$
);
