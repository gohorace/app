-- HOR-155  Daily briefing — "Open homes yesterday" RPC
--
-- Returns one row per inspection an agent ran in the lookback window
-- (typically the previous 24 hours) with:
--   • scan_count    — number of inspection_scans rows
--   • revisit_count — number of those scans whose contact has any event
--                     row recorded after the scan timestamp
--   • scans         — jsonb array of { name, captured_at, has_revisit }
--                     for the per-scan line items in the email block
--
-- Surface design tradeoffs:
--   • "Has revisit" is computed per-scan via the events.contact_id FK
--     (HOR-65 Phase 1 column). No tracker-cookie cross-domain magic —
--     cross-domain attribution lands with v2 custom domains.
--   • Behaviour phrasing ("looking at properties" / "back on appraisal
--     page" etc.) is computed application-side from the events. v1
--     ships the simpler "back on your site" / "no revisit yet"
--     dichotomy directly from has_revisit. Polish lands when richer
--     phrasing is worth a follow-up.
--
-- Naming: the function is `get_daily_briefing_inspections` (matches the
-- existing `get_daily_briefing_data` shape) even though the user-facing
-- email heading is "Open homes yesterday". Code identifier ↔ user copy
-- split is the established Doorstep convention.
--
-- ⚠️ Migration drift: `_migrations` is stale since 2026-04-29. Apply
-- via the Supabase SQL editor in prod, NOT via supabase db push. Same
-- path as 20260515000002 + 20260515000003.

BEGIN;

CREATE OR REPLACE FUNCTION get_daily_briefing_inspections(
  p_agent_id uuid,
  p_since    timestamptz
)
RETURNS TABLE (
  inspection_id   uuid,
  inspection_type text,
  address         text,
  scheduled_at    timestamptz,
  scan_count      int,
  revisit_count   int,
  scans           jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH agent_inspections AS (
    SELECT
      i.id,
      i.inspection_type,
      i.scheduled_at,
      trim(
        regexp_replace(
          coalesce(p.street_number || ' ', '')
            || coalesce(p.street_name, '')
            || coalesce(', ' || p.suburb, ''),
          '^,\s*|,\s*$', '', 'g'
        )
      ) AS address_raw
    FROM inspections i
    LEFT JOIN properties p ON p.id = i.property_id
    WHERE i.agent_id     = p_agent_id
      AND i.scheduled_at >= p_since
      AND i.scheduled_at <  now()
      AND i.deleted_at  IS NULL
      AND i.status      <> 'cancelled'
  ),
  scans_with_revisit AS (
    SELECT
      s.inspection_id,
      s.contact_id,
      s.captured_at,
      EXISTS (
        SELECT 1
        FROM events e
        WHERE e.contact_id  = s.contact_id
          AND e.occurred_at > s.captured_at
      ) AS has_revisit
    FROM inspection_scans s
    WHERE s.inspection_id IN (SELECT id FROM agent_inspections)
  ),
  per_inspection AS (
    SELECT
      swr.inspection_id,
      COUNT(*)::int                                              AS scan_count,
      COUNT(*) FILTER (WHERE swr.has_revisit)::int               AS revisit_count,
      jsonb_agg(
        jsonb_build_object(
          'name',         trim(coalesce(c.first_name || ' ', '') || coalesce(c.last_name, '')),
          'captured_at',  swr.captured_at,
          'has_revisit',  swr.has_revisit
        )
        ORDER BY swr.captured_at ASC
      ) AS scans
    FROM scans_with_revisit swr
    LEFT JOIN contacts c ON c.id = swr.contact_id
    GROUP BY swr.inspection_id
  )
  SELECT
    ai.id                                                AS inspection_id,
    ai.inspection_type                                   AS inspection_type,
    CASE
      WHEN ai.address_raw IS NULL OR length(ai.address_raw) = 0 THEN 'the property'
      ELSE ai.address_raw
    END                                                  AS address,
    ai.scheduled_at                                      AS scheduled_at,
    COALESCE(pi.scan_count, 0)                           AS scan_count,
    COALESCE(pi.revisit_count, 0)                        AS revisit_count,
    COALESCE(pi.scans, '[]'::jsonb)                      AS scans
  FROM agent_inspections ai
  LEFT JOIN per_inspection pi ON pi.inspection_id = ai.id
  ORDER BY ai.scheduled_at DESC;
END;
$$;

COMMENT ON FUNCTION get_daily_briefing_inspections(uuid, timestamptz) IS
  'Doorstep digest — per-inspection aggregates for the daily briefing email. Returns inspections the agent ran in [p_since, now()) with scan_count, revisit_count, and a scans jsonb array of { name, captured_at, has_revisit }. See HOR-155.';

COMMIT;
