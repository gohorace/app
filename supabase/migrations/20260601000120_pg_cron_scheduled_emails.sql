-- ============================================================
-- HOR-357  Scheduled tracked emails — pg_cron schedule for the worker
--
-- Schedules a job to invoke the Next.js worker route every minute. The
-- worker (apps/web/src/app/api/cron/process-scheduled-emails) selects
-- email_sends rows where status='scheduled' AND scheduled_at<=now() and
-- dispatches each through the shared sendTrackedEmail path.
--
-- Same architecture as the Core Markets worker (HOR-193, migration
-- 20260517000011): Vercel Hobby can't run this (2 daily-only crons), so
-- pg_cron drives the schedule and pg_net fires an async HTTPS GET at the
-- Next.js route with the standard CRON_SECRET bearer.
--
-- ── Prereqs ──────────────────────────────────────────────────────
-- 1. pg_cron + pg_net extensions already enabled (done for HOR-193).
--
-- 2. ONE new Vault secret (the bearer `cron_secret` is shared with the
--    existing /api/cron/* jobs — do NOT re-create it):
--
--      SELECT vault.create_secret(
--        'https://gohorace.com/api/cron/process-scheduled-emails',
--        'scheduled_emails_worker_url',
--        'Scheduled-email worker URL — HOR-357'
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
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-scheduled-emails') THEN
    PERFORM cron.unschedule('process-scheduled-emails');
  END IF;
END $$;

SELECT cron.schedule(
  'process-scheduled-emails',
  '* * * * *',
  $cron$
    SELECT net.http_get(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'scheduled_emails_worker_url'),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
      ),
      timeout_milliseconds := 5000
    );
  $cron$
);
