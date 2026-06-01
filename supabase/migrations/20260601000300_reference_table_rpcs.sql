-- Reference tables (substrate layer) — behavioural aggregation RPCs.
--
-- The read-only /contacts and /properties substrate surfaces render two columns
-- that aren't stored anywhere: contacts.sessions_7d and properties.visitors.
-- These functions aggregate them server-side from `events` over a 7-day window,
-- mirroring the join/filter pattern already used by get_property_signals
-- (coalesce(property_id, properties->>'property_id'), event_type='property_view').
--
-- Both are STABLE, SECURITY INVOKER, scoped by a workspace_id parameter, and
-- called only from the server via the service-role admin client. Execute is
-- granted to service_role only (revoked from anon/authenticated) so the
-- workspace_id parameter can't be used to probe other workspaces' counts.

-- ── contacts: distinct sessions with activity in the last 7 days, per contact ──
create or replace function public.get_reference_contact_sessions_7d(p_workspace_id uuid)
returns table (contact_id uuid, sessions_7d int)
language sql
stable
security invoker
set search_path = public
as $$
  select e.contact_id, count(distinct e.session_id)::int as sessions_7d
  from events e
  where e.workspace_id = p_workspace_id
    and e.contact_id is not null
    and e.occurred_at >= now() - interval '7 days'
  group by e.contact_id
$$;

-- ── properties: 7-day property_view engagement, per property ───────────────────
--   views_7d         total property_view events  (gross views)
--   visitors         distinct sessions           (unique visits)
--   last_viewed      most recent view timestamp
--   top_viewer_score highest score among known contacts who viewed (0 if none) —
--                    drives the property's derived top_signal (strongest buyer
--                    intent currently looking at it).
create or replace function public.get_reference_property_engagement_7d(p_workspace_id uuid)
returns table (property_id uuid, views_7d int, visitors int, last_viewed timestamptz, top_viewer_score int)
language sql
stable
security invoker
set search_path = public
as $$
  with win_events as (
    select
      coalesce(e.property_id, nullif(e.properties->>'property_id', '')::uuid) as property_id,
      e.session_id,
      e.contact_id,
      e.occurred_at
    from events e
    where e.workspace_id = p_workspace_id
      and e.event_type = 'property_view'
      and e.occurred_at >= now() - interval '7 days'
  ),
  agg as (
    select
      we.property_id,
      count(*)::int                      as views_7d,
      count(distinct we.session_id)::int as visitors,
      max(we.occurred_at)                as last_viewed
    from win_events we
    where we.property_id is not null
    group by we.property_id
  ),
  viewer as (
    select we.property_id, max(c.score)::int as top_viewer_score
    from win_events we
    join contacts c on c.id = we.contact_id
    where we.property_id is not null
      and c.workspace_id = p_workspace_id
      and c.deleted_at is null
    group by we.property_id
  )
  select
    a.property_id,
    a.views_7d,
    a.visitors,
    a.last_viewed,
    coalesce(v.top_viewer_score, 0) as top_viewer_score
  from agg a
  left join viewer v using (property_id)
$$;

-- Least-privilege: server-side (service_role) only.
revoke execute on function public.get_reference_contact_sessions_7d(uuid)   from public, anon, authenticated;
revoke execute on function public.get_reference_property_engagement_7d(uuid) from public, anon, authenticated;
grant  execute on function public.get_reference_contact_sessions_7d(uuid)   to service_role;
grant  execute on function public.get_reference_property_engagement_7d(uuid) to service_role;
