-- ============================================================
-- HOR-192  Core Markets — suburb-picker typeahead RPC (5 of 7)
--
-- search_localities(p_q, p_limit) powers the suburb-picker typeahead
-- in onboarding (HOR-194) and Settings → Core markets (HOR-196).
--
-- SECURITY DEFINER so the anon-client → /api/localities/search route
-- doesn't depend on direct SELECT on gnaf.localities (which is
-- RLS-locked from anon/authenticated; only service_role can read).
-- The function runs as its owner (postgres on Supabase) and bypasses
-- RLS.
--
-- Ranking:
--   1. Prefix match wins (most natural for "Paddi" → "Paddington")
--   2. Tie-broken by pg_trgm similarity score (so "Padington"
--      with a typo still surfaces Paddington)
--   3. Final tiebreak alphabetical
--
-- p_limit clamped to 50 to defend against the UI sending silly values.
-- ============================================================

CREATE OR REPLACE FUNCTION public.search_localities(
  p_q     text,
  p_limit int DEFAULT 10
)
RETURNS TABLE (
  locality_pid  text,
  locality_name text,
  state_abbrev  text,
  postcode      text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, gnaf
AS $$
  SELECT l.locality_pid,
         l.locality_name,
         l.state_abbrev,
         l.postcode
  FROM gnaf.localities l
  WHERE p_q IS NOT NULL
    AND length(trim(p_q)) >= 2  -- avoid full-table scans on 1-char queries
    AND (
      l.locality_name ILIKE p_q || '%'
      OR l.locality_name % p_q
    )
  ORDER BY
    (l.locality_name ILIKE p_q || '%') DESC,        -- prefix wins
    similarity(l.locality_name, p_q)   DESC,        -- typo-tolerant fallback
    l.locality_name                                  -- stable final order
  LIMIT LEAST(coalesce(p_limit, 10), 50);
$$;

GRANT EXECUTE ON FUNCTION public.search_localities(text, int) TO authenticated, anon;

COMMENT ON FUNCTION public.search_localities(text, int) IS
  'HOR-192: suburb-picker typeahead. SECURITY DEFINER so anon/authenticated callers don''t need direct SELECT on gnaf.localities. Returns top N (default 10, capped at 50) by prefix-then-trgm-similarity. Requires query length >= 2 to avoid full scans.';
