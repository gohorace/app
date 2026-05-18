-- HOR-216 · MapPayload signal RPCs for the Properties Map View (epic HOR-215).
--
-- Three read-only RPCs that turn workspace event activity into the shapes the
-- map renders: per-property pin intensity, per-suburb aggregate state, and a
-- heat grid. The RPCs are the public contract — designed to be MCP-callable in
-- V1.5 (per CLAUDE.md), so return shapes are flat, stable, and unambiguous.
--
-- Intensity model (`HOR-215.1.b` — Andy to sign off in PR description):
--
--   weight = 0.5 ^ (age_days / 7)
--   raw    = Σ weight over property_view events in the window
--   intensity = LEAST(raw / GREATEST(workspace_max_raw, INTENSITY_NORM_FLOOR), 1.0)
--
-- Half-life of 7 days means an event today carries 2× a week-old event and
-- 8× a three-week-old event. The `INTENSITY_NORM_FLOOR` is the "minimum
-- denominator" — a workspace with one stray event won't have that event
-- normalise to 1.0; it'll stay quiet until raw activity reaches the floor.
--
-- Tier thresholds map to the design's three pin tiers / four suburb states:
--
--   property  quiet < 0.25 ≤ active < 0.65 ≤ hot
--   suburb    quiet < 0.25 ≤ warm   < 0.65 ≤ hot
--   suburb    state := 'stirring' when signal_delta_pct ≥ +25% AND state != 'hot'
--
-- All three RPCs SECURITY DEFINER + service_role-only. The wrapping API route
-- enforces auth (workspace ownership) before calling, so these trust the caller
-- the same way `import_core_market_batch` does (precedent: 20260517000010).

-- ─── Tunable constants ──────────────────────────────────────────────────────

-- Time-window mapping. The brief specifies '24h' | '7d' | '30d'; map to days.
-- Anything older than the window is excluded from `raw` (zero weight is fine
-- but we still pay the index scan, so cut at the window boundary).
--
-- We embed these inline rather than splitting into a constants table to keep
-- the migration single-file and reviewable. Tunable in this file.

-- ─── 1. get_property_signals ────────────────────────────────────────────────

create or replace function public.get_property_signals(
  p_workspace_id uuid,
  p_agent_id     uuid,
  p_time_window  text  -- '24h' | '7d' | '30d'
)
returns table (
  id              uuid,
  address         text,
  suburb          text,
  latitude        numeric,
  longitude       numeric,
  state           text,                  -- 'quiet' | 'active' | 'hot'
  intensity       numeric,               -- normalised 0..1
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
    -- Property-view events in the time window, joining either the new
    -- `property_id` column or the legacy JSONB `properties->>'property_id'`
    -- so we don't drop signal from older rows. (Audit HOR-215.1.a will tell
    -- us how much each path contributes.)
    win_events as (
      select
        coalesce(e.property_id, nullif(e.properties->>'property_id','')::uuid) as property_id,
        e.session_id,
        e.contact_id,
        e.occurred_at,
        -- decay weight: half-life 7 days
        power(0.5, extract(epoch from (now() - e.occurred_at)) / 86400.0 / 7.0) as weight
      from events e, window_days w
      where e.workspace_id = p_workspace_id
        and e.event_type   = 'property_view'
        and e.occurred_at >= now() - make_interval(days => w.d::int)
    ),
    -- Aggregate per property: raw weighted intensity, session count, last seen.
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
    -- Workspace-wide max raw — denominator for normalisation. Floored at 8.0
    -- so a quiet workspace doesn't over-warm on a single event.
    max_raw as (
      select greatest(coalesce(max(raw), 0)::numeric, 8.0) as denom from per_property
    ),
    -- For each property, pick the contact owned by the calling agent with
    -- the most recent activity in this window. The brief's `knownContact` is
    -- a single name + since-date; we pick "the agent's contact most active
    -- on this property right now" as the canonical surface.
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
      -- HOR-65: `agent_id` is the legacy column; `owner_agent_id` is canonical
      -- in v1 but nullable. Existing read-paths (properties/page.tsx:132,
      -- /api/properties/[id]/route.ts:73) still filter on `agent_id`, so we
      -- match that pattern to stay consistent with what the list view shows.
      where c.workspace_id = p_workspace_id
        and c.agent_id     = p_agent_id
        and c.deleted_at   is null
      order by we.property_id, we.occurred_at desc
    )
  select
    p.id,
    -- Address rendered the same way the list view does: "12 Maple Street".
    -- Matches the row construction in properties/page.tsx so the panel CTA
    -- shows the same string the agent already recognises.
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
    coalesce(pp.last_seen, p.last_activity_at)        as last_seen,
    kc.contact_name                                   as known_contact_name,
    kc.contact_since                                  as known_contact_since
  from properties p
  cross join max_raw mr
  left join per_property pp  on pp.property_id = p.id
  left join known_contact kc on kc.property_id = p.id
  where p.workspace_id = p_workspace_id
    and p.deleted_at is null
  -- Match the list view's ordering so the panel "next/prev" intuition
  -- carries between list and map (acceptance criterion in HOR-216).
  order by p.last_activity_at desc nulls last, p.id;
$$;

revoke all on function public.get_property_signals(uuid, uuid, text) from public;
grant execute on function public.get_property_signals(uuid, uuid, text) to service_role;

-- ─── 2. get_suburb_signals ──────────────────────────────────────────────────

create or replace function public.get_suburb_signals(
  p_workspace_id uuid,
  p_agent_id     uuid,           -- reserved; not used in V1 (suburb signal is workspace-wide)
  p_time_window  text
)
returns table (
  id               text,         -- gnaf.localities.locality_pid when matched, else lower(suburb_name)
  name             text,         -- canonical name from gnaf.localities when matched, else properties.suburb verbatim
  state_abbrev     text,         -- nullable when no GNAF match
  latitude         numeric,      -- centroid; nullable when no GNAF match
  longitude        numeric,
  state            text,         -- 'quiet' | 'warm' | 'hot' | 'stirring'
  intensity        numeric,      -- normalised 0..1 across the workspace's suburbs
  signal_delta_pct numeric,      -- current period vs previous period of same length, percent
  property_count   integer       -- # of workspace properties in this suburb (active or not)
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
    -- Raw weighted intensity per suburb, current period.
    -- Group on `properties.suburb` (text) because not every property has a
    -- gnaf_address_detail_pid yet (legacy CSV imports). We join to localities
    -- by name+state below to attach a centroid.
    cur_per_suburb as (
      select
        p.suburb,
        sum(power(0.5, extract(epoch from (now() - e.occurred_at)) / 86400.0 / 7.0)) as raw
      from events e, window_days w
      join properties p on p.id = coalesce(e.property_id, nullif(e.properties->>'property_id','')::uuid)
      where e.workspace_id = p_workspace_id
        and e.event_type   = 'property_view'
        and e.occurred_at >= now() - make_interval(days => w.d::int)
        and p.workspace_id = p_workspace_id
        and p.deleted_at is null
      group by p.suburb
    ),
    -- Same shape, previous period of equal length, for the delta.
    prev_per_suburb as (
      select
        p.suburb,
        sum(power(0.5, extract(epoch from ((now() - make_interval(days => w.d::int)) - e.occurred_at))
                       / 86400.0 / 7.0)) as raw
      from events e, window_days w
      join properties p on p.id = coalesce(e.property_id, nullif(e.properties->>'property_id','')::uuid)
      where e.workspace_id = p_workspace_id
        and e.event_type   = 'property_view'
        and e.occurred_at >= now() - make_interval(days => (w.d * 2)::int)
        and e.occurred_at <  now() - make_interval(days => w.d::int)
        and p.workspace_id = p_workspace_id
        and p.deleted_at is null
      group by p.suburb
    ),
    -- Workspace property counts per suburb (whole pool, ignores activity).
    -- Drives whether a suburb appears at all on the map.
    sub_counts as (
      select p.suburb, count(*)::int as property_count
      from properties p
      where p.workspace_id = p_workspace_id
        and p.deleted_at is null
      group by p.suburb
    ),
    max_raw as (
      select greatest(coalesce(max(raw), 0)::numeric, 8.0) as denom from cur_per_suburb
    )
  select
    -- Prefer GNAF locality_pid as the stable id; fall back to lowercase name
    -- (won't be MCP-stable but keeps quiet suburbs addressable in the UI).
    coalesce(loc.locality_pid, lower(sc.suburb)) as id,
    coalesce(loc.locality_name, sc.suburb)        as name,
    loc.state_abbrev                              as state_abbrev,
    loc.latitude                                  as latitude,
    loc.longitude                                 as longitude,
    -- Resolve state. `stirring` takes precedence over warm/quiet when the
    -- delta is large; never overrides hot — a hot suburb is hot, full stop.
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
    -- signal_delta_pct: NULL when previous period was empty (avoids divide-by-zero
    -- and a misleading "infinite growth" headline). The 999.0 escape above only
    -- triggers the `stirring` branch — the column itself stays NULL on no-prior.
    case
      when coalesce(prev.raw, 0) = 0 then null
      else 100.0 * (coalesce(cur.raw, 0) - prev.raw) / prev.raw
    end                                                 as signal_delta_pct,
    coalesce(sc.property_count, 0)                      as property_count
  from sub_counts sc
  cross join max_raw mr
  left join cur_per_suburb cur on cur.suburb = sc.suburb
  left join prev_per_suburb prev on prev.suburb = sc.suburb
  -- Centroid lookup via the suburb name (case-insensitive) within QLD or the
  -- agent's core markets. The match is best-effort; legacy suburbs without
  -- a GNAF entry still appear with null centroid (map renders no label).
  left join lateral (
    select l.locality_pid, l.locality_name, l.state_abbrev, l.latitude, l.longitude
    from gnaf.localities l
    where lower(l.locality_name) = lower(sc.suburb)
    -- Tie-break on state by joining through any property in this workspace
    -- whose `state` column matches — keeps Brisbane Paddington distinct from
    -- Sydney Paddington for an Australia-wide workspace.
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

-- ─── 3. get_map_heat_cells ──────────────────────────────────────────────────
--
-- One heat cell per property with coordinates AND positive intensity. We don't
-- bucket into a viewport grid for V1 because workspace property count is capped
-- at 500 on the list view — 500 cells is well below the brief's 2000-cell cap.
-- If/when we lift the property cap, bucket into a `round(lat*1000)/1000` grid
-- here without changing the RPC signature.

create or replace function public.get_map_heat_cells(
  p_workspace_id uuid,
  p_time_window  text
)
returns table (
  latitude  numeric,
  longitude numeric,
  intensity numeric
)
language sql
stable
security definer
set search_path = public
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
        power(0.5, extract(epoch from (now() - e.occurred_at)) / 86400.0 / 7.0) as weight
      from events e, window_days w
      where e.workspace_id = p_workspace_id
        and e.event_type   = 'property_view'
        and e.occurred_at >= now() - make_interval(days => w.d::int)
    ),
    per_property as (
      select property_id, sum(weight) as raw
      from win_events
      where property_id is not null
      group by property_id
    ),
    max_raw as (
      select greatest(coalesce(max(raw), 0)::numeric, 8.0) as denom from per_property
    )
  select
    p.latitude,
    p.longitude,
    least(pp.raw / mr.denom, 1.0) as intensity
  from per_property pp
  cross join max_raw mr
  join properties p on p.id = pp.property_id
  where p.workspace_id   = p_workspace_id
    and p.deleted_at    is null
    and p.latitude      is not null
    and p.longitude     is not null
    and pp.raw / mr.denom >= 0.04  -- match the client's `intensity > 0.04` render gate
  order by intensity desc
  limit 2000;
$$;

revoke all on function public.get_map_heat_cells(uuid, text) from public;
grant execute on function public.get_map_heat_cells(uuid, text) to service_role;

-- ─── Notes for HOR-217 (next child) ─────────────────────────────────────────
--
-- The MapPayload `summary` field is composed in the API route by calling
-- `generateMapSummary()` in `apps/web/src/lib/ai/map-summary.ts`. That lands
-- in HOR-217 alongside the time scrubber. This migration leaves room: the
-- API route can stub `summary: ''` until then, and the suburb signal output
-- (top warm/hot/stirring names) is already enough input for the Haiku prompt.
