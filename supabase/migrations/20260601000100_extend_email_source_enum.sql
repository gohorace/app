-- HOR-356 — extend email_sends.source for the composer-dock entry points.
--
-- V1 allowed ('ui','mcp','digest_prompt'). Communication V2 opens the tracked-
-- email composer from three distinct UI surfaces (Stream, Contact header,
-- Companion); collapsing all three to a bare 'ui' would lose per-surface
-- attribution. Extend the CHECK so each surface is recorded on email_sends.
--
-- outreach_log stays coarse ('mcp','ui','auto') — see mapToOutreachSource().
--
-- Apply via Studio SQL editor + manual schema_migrations INSERT (NOT db push)
-- until HOR-131 resolves the legacy timestamp drift.

alter table public.email_sends
  drop constraint if exists email_sends_source_check;

alter table public.email_sends
  add constraint email_sends_source_check
  check (source in ('ui', 'mcp', 'digest_prompt', 'stream', 'contact', 'companion'));
