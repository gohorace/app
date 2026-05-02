-- ============================================================
-- Push subscriptions — one per agent per browser/device
-- ============================================================

CREATE TABLE push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  endpoint    text NOT NULL,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id, endpoint)
);

CREATE INDEX push_subscriptions_agent_id_idx ON push_subscriptions(agent_id);

-- ============================================================
-- Add timezone to agent_settings
-- Replaces weekly_briefing_day with daily_briefing_hour
-- ============================================================

ALTER TABLE agent_settings
  ADD COLUMN IF NOT EXISTS timezone          text NOT NULL DEFAULT 'Australia/Sydney',
  ADD COLUMN IF NOT EXISTS daily_briefing_hour smallint NOT NULL DEFAULT 17
    CHECK (daily_briefing_hour BETWEEN 0 AND 23);

-- ============================================================
-- Update notification_log type constraint
-- Add alert types, rename email_briefing → email_daily_brief
-- ============================================================

ALTER TABLE notification_log
  DROP CONSTRAINT IF EXISTS notification_log_type_check;

ALTER TABLE notification_log
  ADD CONSTRAINT notification_log_type_check
  CHECK (type IN (
    'email_daily_brief',
    'alert_score_threshold',
    'alert_form_submit',
    'alert_return_visit'
  ));

-- Migrate existing rows
UPDATE notification_log SET type = 'email_daily_brief' WHERE type = 'email_briefing';
