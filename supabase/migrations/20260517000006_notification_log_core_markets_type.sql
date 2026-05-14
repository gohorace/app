-- ============================================================
-- HOR-192  Core Markets — notification_log type widen (4 of 7)
--
-- Add 'core_markets_import_complete' to the notification_log.type
-- enum so the import-complete notification (HOR-193) can land there.
--
-- The full set was last touched by 20260515000002_inspections_v1.sql
-- which added inspection_capture + inspection_revisit. We re-add the
-- full list with the new type appended.
--
-- Standard pattern: notification_log is a write-once log used for
-- both dedup (don't re-alert the same agent on the same contact
-- within 24h) and as the source for the in-app activity feed
-- (HOR-130). The Core Markets entry shows up as an item in the
-- /notifications feed via to-stream-moment.ts + derive-moment-type.ts
-- (wired in HOR-193).
-- ============================================================

ALTER TABLE notification_log DROP CONSTRAINT IF EXISTS notification_log_type_check;

ALTER TABLE notification_log ADD CONSTRAINT notification_log_type_check
  CHECK (type IN (
    'email_daily_brief',
    'alert_score_threshold',
    'alert_form_submit',
    'alert_return_visit',
    'email_workspace_invite',
    'volume_review',
    'alert_inspection_capture',
    'alert_inspection_revisit',
    'core_markets_import_complete'
  ));
