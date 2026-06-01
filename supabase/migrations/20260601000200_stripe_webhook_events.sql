-- Bug bash · Stripe webhook idempotency ledger
--
-- Stripe delivers webhooks at-least-once: on any non-2xx (or its own retry
-- schedule) it re-sends the SAME event.id. Our handler re-ran syncSubscription
-- / the cancel on every replay, so a late-arriving stale `subscription.updated`
-- after a `subscription.deleted` could resurrect a canceled subscription.
--
-- This table records each handled event.id. The handler inserts a row at the
-- top of processing and short-circuits (acks 200) on a unique-violation, so an
-- event is only ever applied once. The handler fails OPEN if this insert errors
-- for any reason OTHER than a duplicate (e.g. during rollout before this table
-- exists), so a logging-table problem can never drop a real billing event.
--
-- ⚠️ Migration drift: supabase_migrations.schema_migrations is reconciled
-- through 20260513000010. Apply via the Studio SQL editor + a manual
-- INSERT INTO supabase_migrations.schema_migrations (version) VALUES
-- ('20260601000200'), NOT `supabase db push`, until HOR-131. See
-- ~/.claude/projects/-Users-andytwomey-code/memory/horace_migration_tracking_drift.md.

BEGIN;

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id    text PRIMARY KEY,
  event_type  text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE stripe_webhook_events IS
  'Idempotency ledger for the Stripe webhook (POST /api/webhooks/stripe). One '
  'row per handled event.id; the handler short-circuits on a duplicate so '
  'at-least-once redelivery is applied exactly once.';

-- Service-role only (the webhook uses the admin client). Enable RLS with no
-- policies so anon/authenticated have no access; service role bypasses RLS.
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;

COMMIT;
