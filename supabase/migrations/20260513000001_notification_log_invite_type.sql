-- ============================================================
-- HOR-99  Widen notification_log.type to allow workspace invite audits
--
-- Adds 'email_workspace_invite' to the type CHECK constraint so the
-- POST /api/workspaces/:id/invites route can log a row each time an
-- invite email is sent. Same pattern as 20260502000001 used when push
-- subscriptions added alert types.
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
    'email_workspace_invite'
  ));

COMMIT;
