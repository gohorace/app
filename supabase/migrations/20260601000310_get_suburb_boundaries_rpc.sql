-- HOR-369 · get_suburb_boundaries — serve suburb polygons for the choropleth.
--
-- Companion to 20260601000300_suburb_boundaries.sql. Returns one row per
-- workspace suburb that HAS a boundary, keyed by the SAME `id` that
-- get_suburb_signals emits, so the map-payload route can attach a parallel
-- `boundaries[]` array keyed by suburb id (leaner cache key than fattening
-- every SuburbSignal — geometry stays out of the Haiku summary cache key).
--
-- Suburbs with no matched boundary simply don't appear here; the FE falls back
-- to radial heat at city zoom for those (HOR-369 documented fallback).
--
-- The suburb→id resolution mirrors get_suburb_signals exactly
-- (coalesce(locality_pid, lower(suburb)), name+state lateral join) so the ids
-- line up 1:1 with the suburbs[] array on the same payload. Keep the two in
-- lockstep: if the id derivation changes there, change it here.
--
-- SECURITY DEFINER + service_role-only, matching the other map RPCs. The
-- wrapping API route enforces workspace auth before calling.
--
-- Apply via Studio SQL editor, then reconcile schema_migrations (see the table
-- migration header) — NOT `db push`:
--   INSERT INTO supabase_migrations.schema_migrations (version, name)
--     VALUES ('20260601000310', 'get_suburb_boundaries_rpc');

create or replace function public.get_suburb_boundaries(
  p_workspace_id uuid,
  p_agent_id     uuid,           -- reserved; not used in V1 (workspace-wide, mirrors get_suburb_signals)
  p_time_window  text            -- reserved; boundaries are time-invariant, accepted for signature parity
)
returns table (
  id               text,         -- gnaf locality_pid when matched, else lower(suburb) — same as get_suburb_signals
  boundary_geojson jsonb,        -- GeoJSON geometry (Polygon|MultiPolygon), simplified
  centroid_lat     numeric,
  centroid_lng     numeric
)
language sql
stable
security definer
set search_path = public, gnaf
as $$
  with sub_suburbs as (
    -- Distinct workspace suburbs (mirrors get_suburb_signals' sub_counts pool).
    select distinct p.suburb
    from properties p
    where p.workspace_id = p_workspace_id
      and p.deleted_at is null
      and p.suburb is not null
  ),
  resolved as (
    -- Resolve each suburb to the canonical id exactly as get_suburb_signals does.
    select coalesce(loc.locality_pid, lower(ss.suburb)) as id
    from sub_suburbs ss
    left join lateral (
      select l.locality_pid
      from gnaf.localities l
      where lower(l.locality_name) = lower(ss.suburb)
        and l.state_abbrev = (
          select p.state from properties p
          where p.workspace_id = p_workspace_id
            and p.suburb = ss.suburb
            and p.deleted_at is null
          limit 1
        )
      limit 1
    ) loc on true
  )
  select
    r.id,
    b.boundary_geojson,
    b.centroid_lat,
    b.centroid_lng
  from resolved r
  join public.suburb_boundaries b on b.locality_key = r.id;
$$;

revoke all    on function public.get_suburb_boundaries(uuid, uuid, text) from public;
grant  execute on function public.get_suburb_boundaries(uuid, uuid, text) to service_role;
