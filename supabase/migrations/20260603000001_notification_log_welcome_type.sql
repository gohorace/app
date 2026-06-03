-- ============================================================
-- New-user welcome email — extend notification_log type vocabulary
--
-- When a brand-new account provisions (the once-per-signup branch in
-- lib/onboarding/bootstrap.ts), we send a single welcome email in
-- Horace's voice and audit it here. Add 'email_welcome' to the type
-- CHECK so that insert is accepted.
--
-- Mirrors the prior extensions (…_core_markets_type, _portal_enquiry…).
-- ============================================================

BEGIN;

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
    'core_markets_import_complete',
    'alert_embed_capture',
    'alert_portal_enquiry',
    'email_welcome'
  ));

COMMIT;
