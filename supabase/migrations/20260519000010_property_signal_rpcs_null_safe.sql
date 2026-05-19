-- Properties Map View · root-cause fixes for two bugs caught in prod on 2026-05-19.
--
-- Bug 1 (HOR-239): `get_suburb_signals` returned null `name` for legacy
-- properties.suburb=NULL rows. Read-path was patched in PR #107; this is the
-- SQL-side fix that prevents the null reaching the route in the first place.
--
-- Bug 2 (pattern-line "Active right now" on a property with 0 sessions):
-- `get_property_signals` did `coalesce(pp.last_seen, p.last_activity_at) as
-- last_seen` — conflating visitor session time with property-row freshness.
-- A freshly-imported property had a recent last_activity_at, fallback fired,
-- the panel said "Active right now" even though sessionCount was 0.
--
-- Both RPCs are recreated via CREATE OR REPLACE FUNCTION. No data touched.
-- Other RPC behaviour unchanged; constants stay where they were in
-- 20260518000040_property_signal_rpcs.sql (decay half-life 7 days, normalisation
-- floor 8.0, tier thresholds 0.25 / 0.65).

-- ─── 1. get_property_signals — drop the last_seen coalesce ──────────────────

create or replace function public.get_property_signals(
  p_workspace_id uuid,
  p_agent_id     uuid,
  p_time_window  text
)
returns table (
  id              uuid,
  address         text,
  suburb          text,
  latitude        numeric,
  longitude       numeric,
  state           text,
  intensity       numeric,
  session_count   integer,
  last_seen       timestamptz,
  known_contact_name text,
  known_contact_since timestamptz
)
language sql
stable
security definer
set search_path = public, gnaf
as $$
  with
    window_days as (
      select case p_time_window
        when '24h' then 1.0
        when '30d' then 30.0
        else 7.0
      end as d
    ),
    win_events as (
      select
        coalesce(e.property_id, nullif(e.properties->>'property_id','')::uuid) as property_id,
        e.session_id,
        e.contact_id,
        e.occurred_at,
        power(0.5, extract(epoch from (now() - e.occurred_at)) / 86400.0 / 7.0) as weight
      from events e
      cross join window_days w
      where e.workspace_id = p_workspace_id
        and e.event_type   = 'property_view'
        and e.occurred_at >= now() - make_interval(days => w.d::int)
    ),
    per_property as (
      select
        we.property_id,
        sum(we.weight)                       as raw,
        count(distinct we.session_id)::int   as session_count,
        max(we.occurred_at)                  as last_seen
      from win_events we
      where we.property_id is not null
      group by we.property_id
    ),
    max_raw as (
      select greatest(coalesce(max(raw), 0)::numeric, 8.0) as denom from per_property
    ),
    known_contact as (
      select distinct on (we.property_id)
        we.property_id,
        c.id          as contact_id,
        coalesce(
          nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
          nullif(c.full_name_raw, ''),
          c.email
        )            as contact_name,
        c.created_at as contact_since
      from win_events we
      join contacts c on c.id = we.contact_id
      where c.workspace_id = p_workspace_id
        and c.agent_id     = p_agent_id
        and c.deleted_at   is null
      order by we.property_id, we.occurred_at desc
    )
  select
    p.id,
    trim(concat_ws(' ', p.street_number, p.street_name)) as address,
    p.suburb,
    p.latitude,
    p.longitude,
    case
      when (coalesce(pp.raw, 0) / mr.denom) >= 0.65 then 'hot'
      when (coalesce(pp.raw, 0) / mr.denom) >= 0.25 then 'active'
      else 'quiet'
    end                                              as state,
    least(coalesce(pp.raw, 0) / mr.denom, 1.0)        as intensity,
    coalesce(pp.session_count, 0)                     as session_count,
    -- BUG FIX: was `coalesce(pp.last_seen, p.last_activity_at)`. last_activity_at
    -- updates on property imports / status changes — not visitor sessions — so
    -- it was firing "Active right now" on dormant freshly-imported rows. Return
    -- raw pp.last_seen; null when there's no activity. The route's story
    -- composer (composePatternLine) already short-circuits when sessionCount=0.
    pp.last_seen                                      as last_seen,
    kc.contact_name                                   as known_contact_name,
    kc.contact_since                                  as known_contact_since
  from properties p
  cross join max_raw mr
  left join per_property pp  on pp.property_id = p.id
  left join known_contact kc on kc.property_id = p.id
  where p.workspace_id = p_workspace_id
    and p.deleted_at is null
  order by p.last_activity_at desc nulls last, p.id;
$$;

revoke all on function public.get_property_signals(uuid, uuid, text) from public;
grant execute on function public.get_property_signals(uuid, uuid, text) to service_role;

-- ─── 2. get_suburb_signals — filter null/empty properties.suburb ────────────

create or replace function public.get_suburb_signals(
  p_workspace_id uuid,
  p_agent_id     uuid,
  p_time_window  text
)
returns table (
  id               text,
  name             text,
  state_abbrev     text,
  latitude         numeric,
  longitude        numeric,
  state            text,
  intensity        numeric,
  signal_delta_pct numeric,
  property_count   integer
)
language sql
stable
security definer
set search_path = public, gnaf
as $$
  with
    window_days as (
      select case p_time_window
        when '24h' then 1.0
        when '30d' then 30.0
        else 7.0
      end as d
    ),
    cur_per_suburb as (
      select
        p.suburb,
        sum(power(0.5, extract(epoch from (now() - e.occurred_at)) / 86400.0 / 7.0)) as raw
      from events e
      cross join window_days w
      join properties p on p.id = coalesce(e.property_id, nullif(e.properties->>'property_id','')::uuid)
      where e.workspace_id = p_workspace_id
        and e.event_type   = 'property_view'
        and e.occurred_at >= now() - make_interval(days => w.d::int)
        and p.workspace_id = p_workspace_id
        and p.deleted_at is null
        -- BUG FIX: legacy property rows can have suburb=NULL despite the
        -- current NOT NULL constraint. Filter so they don't propagate into
        -- the suburb signal output as null-name rows.
        and p.suburb is not null
        and trim(p.suburb) <> ''
      group by p.suburb
    ),
    prev_per_suburb as (
      select
        p.suburb,
        sum(power(0.5, extract(epoch from ((now() - make_interval(days => w.d::int)) - e.occurred_at))
                       / 86400.0 / 7.0)) as raw
      from events e
      cross join window_days w
      join properties p on p.id = coalesce(e.property_id, nullif(e.properties->>'property_id','')::uuid)
      where e.workspace_id = p_workspace_id
        and e.event_type   = 'property_view'
        and e.occurred_at >= now() - make_interval(days => (w.d * 2)::int)
        and e.occurred_at <  now() - make_interval(days => w.d::int)
        and p.workspace_id = p_workspace_id
        and p.deleted_at is null
        and p.suburb is not null
        and trim(p.suburb) <> ''
      group by p.suburb
    ),
    sub_counts as (
      select p.suburb, count(*)::int as property_count
      from properties p
      where p.workspace_id = p_workspace_id
        and p.deleted_at is null
        and p.suburb is not null
        and trim(p.suburb) <> ''
      group by p.suburb
    ),
    max_raw as (
      select greatest(coalesce(max(raw), 0)::numeric, 8.0) as denom from cur_per_suburb
    )
  select
    coalesce(loc.locality_pid, lower(sc.suburb)) as id,
    coalesce(loc.locality_name, sc.suburb)        as name,
    loc.state_abbrev                              as state_abbrev,
    loc.latitude                                  as latitude,
    loc.longitude                                 as longitude,
    case
      when (coalesce(cur.raw, 0) / mr.denom) >= 0.65 then 'hot'
      when coalesce(
             100.0 * (coalesce(cur.raw, 0) - coalesce(prev.raw, 0))
                   / nullif(coalesce(prev.raw, 0), 0),
             case when coalesce(cur.raw, 0) > 0 and coalesce(prev.raw, 0) = 0 then 999.0 else 0.0 end
           ) >= 25.0 then 'stirring'
      when (coalesce(cur.raw, 0) / mr.denom) >= 0.25 then 'warm'
      else 'quiet'
    end                                                 as state,
    least(coalesce(cur.raw, 0) / mr.denom, 1.0)         as intensity,
    case
      when coalesce(prev.raw, 0) = 0 then null
      else 100.0 * (coalesce(cur.raw, 0) - prev.raw) / prev.raw
    end                                                 as signal_delta_pct,
    coalesce(sc.property_count, 0)                      as property_count
  from sub_counts sc
  cross join max_raw mr
  left join cur_per_suburb cur on cur.suburb = sc.suburb
  left join prev_per_suburb prev on prev.suburb = sc.suburb
  left join lateral (
    select l.locality_pid, l.locality_name, l.state_abbrev, l.latitude, l.longitude
    from gnaf.localities l
    where lower(l.locality_name) = lower(sc.suburb)
    and l.state_abbrev = (
      select p.state from properties p
      where p.workspace_id = p_workspace_id
        and p.suburb = sc.suburb
        and p.deleted_at is null
      limit 1
    )
    limit 1
  ) loc on true
  order by intensity desc, name;
$$;

revoke all on function public.get_suburb_signals(uuid, uuid, text) from public;
grant execute on function public.get_suburb_signals(uuid, uuid, text) to service_role;
