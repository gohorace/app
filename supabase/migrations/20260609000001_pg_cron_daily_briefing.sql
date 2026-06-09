-- ============================================================
-- Daily briefing — move trigger from Vercel cron to pg_cron (HOURLY)
--
-- BUG: the daily-briefing send was driven by a SINGLE Vercel cron at
-- 07:00 UTC (apps/web/vercel.json), but the handler
-- (apps/web/src/app/api/cron/daily-briefing/route.ts) filters recipients
-- by `local_hour === daily_briefing_hour`, written as if the route runs
-- every hour. Running once a day means the ONLY send hour that can ever
-- match is whatever 07:00 UTC maps to in the agent's timezone — 17:00 for
-- AEST. So `agent_settings.daily_briefing_hour` was effectively dead: any
-- value other than 17 silently filtered the agent out and they received
-- nothing. (Also DST-fragile: 07:00 UTC = 18:00 during AEDT, so even the
-- default-17 agents would go silent each summer.)
--
-- FIX: drive the route HOURLY via pg_cron so the existing per-hour /
-- per-timezone filter becomes correct — each agent matches exactly once a
-- day, in their own configured local hour. The Vercel daily-briefing cron
-- entry is removed in the same PR (apps/web/vercel.json) so it no longer
-- double-fires at 07:00 UTC.
--
-- Same architecture as the scheduled-emails worker (HOR-357,
-- 20260601000120) and the Core Markets worker (HOR-193, 20260517000011):
-- Vercel Hobby can't run hourly (2 daily-only crons), so pg_cron drives
-- the schedule and pg_net fires an async HTTPS GET at the Next.js route
-- with the shared CRON_SECRET bearer.
--
-- ── Prereqs ──────────────────────────────────────────────────────
-- 1. pg_cron + pg_net extensions already enabled (done for HOR-193).
-- 2. The `cron_secret` Vault secret already exists (shared with the other
--    /api/cron/* jobs) — do NOT re-create it.
-- 3. ONE new Vault secret for the route URL:
--
--      SELECT vault.create_secret(
--        'https://gohorace.com/api/cron/daily-briefing',
--        'daily_briefing_worker_url',
--        'Daily-briefing worker URL — fix hourly cron'
--      );
--
-- If the secret is missing, http_get gets a NULL url and pg_net silently
-- drops the request; the migration applies cleanly regardless. Setting the
-- secret later un-stalls the schedule on the next tick.
--
-- NB: http_get (not http_post) — the worker route is `export async
-- function GET(...)`, matching the /api/cron/* convention.
--
-- Apply via Studio SQL editor (NOT db push) until HOR-131 resolves the
-- legacy timestamp drift; then INSERT the row into schema_migrations.
-- ============================================================

SET LOCAL search_path = public, cron, net, vault;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-briefing') THEN
    PERFORM cron.unschedule('daily-briefing');
  END IF;
END $$;

SELECT cron.schedule(
  'daily-briefing',
  '0 * * * *',
  $cron$
    SELECT net.http_get(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'daily_briefing_worker_url'),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
      ),
      timeout_milliseconds := 5000
    );
  $cron$
);
