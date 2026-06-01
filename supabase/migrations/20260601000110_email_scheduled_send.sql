-- HOR-357 — scheduled tracked-email sends.
--
-- V1 sends fire immediately (status 'queued' → 'sent'). The Communication V2
-- composer dock adds "Schedule send": park a row now, let a pg_cron worker
-- (/api/cron/process-scheduled-emails) dispatch it once scheduled_at passes.
--
-- Adds:
--   • scheduled_at      — when the send should fire (null for immediate sends)
--   • status 'scheduled' — parked, not yet attempted; the worker flips it to
--                          'queued' (claim) then 'sent'/'failed' via the
--                          shared dispatchSend path.
--   • a partial index so the worker's "due rows" query stays cheap.
--
-- Mirrors the inspections scheduled_at / Upcoming-Past model.
--
-- Apply via Studio SQL editor + manual schema_migrations INSERT (NOT db push)
-- until HOR-131 resolves the legacy timestamp drift.

alter table public.email_sends
  add column if not exists scheduled_at timestamptz;

alter table public.email_sends
  drop constraint if exists email_sends_status_check;

alter table public.email_sends
  add constraint email_sends_status_check
  check (status in (
    'queued',
    'scheduled',
    'sent',
    'soft_bounced',
    'hard_bounced',
    'failed',
    'spam_complaint'
  ));

-- Worker hot path: "scheduled rows whose time has come", oldest first.
create index if not exists email_sends_due_scheduled_idx
  on public.email_sends (scheduled_at)
  where status = 'scheduled';

comment on column public.email_sends.scheduled_at is
  'HOR-357 — when a scheduled send should fire. Null for immediate sends. '
  'Worker dispatches rows where status=''scheduled'' and scheduled_at <= now().';
