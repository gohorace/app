-- HOR-217 · Cache for the Horace-voiced map summary line.
--
-- The summary line is composed by Claude Haiku on every map-payload refetch.
-- Without caching, every scrubber click costs one LLM round-trip — both in
-- latency and ¢. Cache key is `(workspace_id, agent_id, time_window,
-- payload_hash)` where `payload_hash` fingerprints the inputs (counters,
-- top warm/hot suburb names, stirring suburb names). Identical payload →
-- cache hit. Material change → cache miss → fresh Haiku → cache write.
--
-- 1-hour TTL keeps the voice editable without a release (per CLAUDE.md hard
-- rule on shared surfaces) — clear the cache and the next refetch repaints
-- the prompt.
--
-- This table replaces what HOR-217 would otherwise have done via Redis. The
-- codebase has no KV store yet (memory note on Vercel Hobby cron limits is
-- the closest precedent for "we deliberately stay on Postgres"). Adding the
-- table is cheaper than introducing a new dependency.

create table if not exists public.map_summary_cache (
  workspace_id  uuid        not null,
  agent_id      uuid        not null,
  time_window   text        not null,
  payload_hash  text        not null,
  summary       text        not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '1 hour'),
  primary key (workspace_id, agent_id, time_window, payload_hash)
);

-- Index supports the TTL sweep (expire_old_map_summary_cache below) without
-- a full-table scan when the cache grows. PK already covers the lookup path.
create index if not exists map_summary_cache_expires_idx
  on public.map_summary_cache (expires_at);

revoke all on public.map_summary_cache from public;
grant select, insert, update, delete on public.map_summary_cache to service_role;

-- ─── TTL sweep ──────────────────────────────────────────────────────────────
--
-- Called by pg_cron (registered separately in a follow-up if cache grows
-- noticeably — for V1 the table is bounded by agent × window × hash count,
-- which in practice is < 100 rows per workspace). Provided here so ops can
-- call it ad-hoc.

create or replace function public.expire_old_map_summary_cache()
returns integer
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.map_summary_cache
    where expires_at < now()
    returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke all on function public.expire_old_map_summary_cache() from public;
grant execute on function public.expire_old_map_summary_cache() to service_role;
