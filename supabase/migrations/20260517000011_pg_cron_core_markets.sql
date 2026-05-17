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
--
-- 2. Two Vault secrets set on the project (Dashboard → Project Settings
--    → Vault, or via SQL editor as service_role):
--
--      SELECT vault.create_secret(
--        'https://gohorace.com/api/cron/process-core-market-imports',
--        'cron_worker_url',
--        'Core Markets worker URL — HOR-193'
--      );
--      SELECT vault.create_secret(
--        '<the same value as CRON_SECRET env var on Vercel>',
--        'cron_secret',
--        'Bearer token for Horace cron routes — shared by all /api/cron/*'
--      );
--
--    Supabase's hosted Postgres doesn't grant superuser, so we can't
--    use ALTER DATABASE … SET for these. Vault is the canonical
--    Supabase pattern — encrypted at rest, looked up at cron-fire
--    time via the vault.decrypted_secrets view.
--
-- If either secret is missing, the http_get call gets a NULL url and
-- pg_net silently drops the request. The migration applies cleanly
-- regardless; setting the secrets later un-stalls the schedule on the
-- next tick.
--
-- NB: http_get (not http_post). The worker route is `export async
-- function GET(...)` — matches the existing /api/cron/* convention
-- (daily-briefing, purge-soft-deleted) and Vercel cron docs. An earlier
-- version of this migration used net.http_post which silently 405'd
-- every minute against the deployed GET route. Caught 2026-05-17.
-- ============================================================

-- pg_cron, pg_net, vault live in their own schemas; we add them to
-- search_path so the schedule body and our DO block find them.
SET LOCAL search_path = public, cron, net, vault;

-- Idempotent: drop any prior schedule with the same name before
-- re-creating. cron.unschedule(name) raises if the name doesn't
-- exist, hence the EXISTS guard.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-core-market-imports') THEN
    PERFORM cron.unschedule('process-core-market-imports');
  END IF;
END $$;

-- Every minute. pg_net is async — returns a request_id and the HTTPS
-- call happens in the background, so the cron tick itself is sub-
-- millisecond. The actual import work happens inside the Next.js
-- route, which has up to 60s on Vercel Hobby (the route sets
-- maxDuration to make this explicit).
--
-- The URL + secret are looked up from Vault on every fire. SECURITY
-- DEFINER is implicit — cron jobs run as the user who scheduled them
-- (the `postgres` role here), which has SELECT on vault.decrypted_secrets.
SELECT cron.schedule(
  'process-core-market-imports',
  '* * * * *',
  $cron$
    SELECT net.http_get(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_worker_url'),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
      ),
      timeout_milliseconds := 5000
    );
  $cron$
);

COMMENT ON EXTENSION pg_cron IS
  'HOR-193: drives the Core Markets import worker via /api/cron/process-core-market-imports every minute. Also a candidate to replace the Vercel-cron-based daily-briefing and purge-soft-deleted jobs once HOR-200 lands.';
