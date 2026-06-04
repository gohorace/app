-- Site audit (/audit) — lead capture
--
-- The public site-audit experience runs five checks against an agent's website
-- and renders a report. After reading it, the agent can ask for "the full
-- report as a PDF + the playbook" by leaving their email. That capture lands
-- here. The findings snapshot is stored alongside so a later batch job (PDF /
-- playbook send / sales follow-up) has everything it needs without re-running
-- the audit.
--
-- Not tied to a workspace or agent — these are inbound prospects who have no
-- Horace account. Writes are service-role only (the capture API uses the admin
-- client); RLS is enabled with no public policies so nothing is readable by the
-- anon/auth roles.

create table if not exists public.site_audit_leads (
  id          uuid primary key default gen_random_uuid(),
  domain      text not null,
  email       text not null,
  -- AuditResult JSON (findings, verdict, top-3) captured at submit time.
  result      jsonb,
  -- Light provenance for abuse triage; not used for marketing.
  ip          text,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists site_audit_leads_email_idx on public.site_audit_leads (email);
create index if not exists site_audit_leads_domain_idx on public.site_audit_leads (domain);
create index if not exists site_audit_leads_created_idx on public.site_audit_leads (created_at desc);

alter table public.site_audit_leads enable row level security;
-- No policies: anon/authenticated get nothing. Service role bypasses RLS.

comment on table public.site_audit_leads is
  'Inbound leads from the public /audit site-audit tool. Service-role writes only; no workspace/agent FK (prospects have no account).';
