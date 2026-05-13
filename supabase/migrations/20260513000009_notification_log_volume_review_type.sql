-- ============================================================
-- HOR-74  Widen notification_log.type to allow volume-review markers
--
-- The push dispatch wrapper logs a 'volume_review' row when an agent
-- exceeds the daily push cap, so we don't ping #horace-alert-volume
-- twice within 24h for the same agent. Same pattern as 20260513000001.
-- ============================================================

BEGIN;

ALTER TABLE notification_log
  DROP CONSTRAINT IF EXISTS notification_log_type_check;

ALTER TABLE notification_log
  ADD CONSTRAINT notification_log_type_check
  CHECK (type IN (
    'email_daily_brief',
    'alert_score_threshold',
    'alert_form_submit',
    'alert_return_visit',
    'email_workspace_invite',
    'volume_review'
  ));

COMMIT;
