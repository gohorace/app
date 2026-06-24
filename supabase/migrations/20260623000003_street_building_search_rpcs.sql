-- ============================================================
-- HOR-410  Granular location import — search RPCs (3 of 4)
--
-- Typeahead RPCs for the two new import granularities, mirroring
-- search_localities (HOR-192): SECURITY DEFINER so the anon-client
-- API routes don't need direct SELECT on the RLS-locked gnaf.* tables,
-- prefix-then-trgm ranking, query length >= 2, p_limit clamped to 50.
--
--   • search_streets   — over gnaf.street_localities.
--   • search_buildings — over gnaf.complexes (structural P/S buildings).
--
-- Both surface the locality + postcode so the UI can disambiguate
-- duplicate names (e.g. "George Street" in many suburbs), and an
-- approximate count so the agent sees scope size before confirming.
--
-- Optional p_locality_pid scopes results to one suburb — used when the
-- user has already chosen a suburb to narrow within.
-- ============================================================

-- ─── search_streets ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_streets(
  p_q            text,
  p_limit        int  DEFAULT 10,
  p_locality_pid text DEFAULT NULL
)
RETURNS TABLE (
  street_locality_pid text,
  street_name         text,
  street_type_code    text,
  locality_pid        text,
  locality_name       text,
  state_abbrev        text,
  postcode            text,
  address_count       integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, gnaf
AS $$
  SELECT s.street_locality_pid,
         s.street_name,
         s.street_type_code,
         s.locality_pid,
         s.locality_name,
         s.state_abbrev,
         s.postcode,
         s.address_count
  FROM gnaf.street_localities s
  WHERE p_q IS NOT NULL
    AND length(trim(p_q)) >= 2
    AND (p_locality_pid IS NULL OR s.locality_pid = p_locality_pid)
    AND (
      s.street_name ILIKE p_q || '%'
      OR s.street_name % p_q
    )
  ORDER BY
    (s.street_name ILIKE p_q || '%') DESC,   -- prefix wins
    similarity(s.street_name, p_q)   DESC,   -- typo-tolerant fallback
    s.address_count                  DESC,   -- bigger streets first on ties
    s.street_name,                           -- stable
    s.locality_name
  LIMIT LEAST(coalesce(p_limit, 10), 50);
$$;

GRANT EXECUTE ON FUNCTION public.search_streets(text, int, text) TO authenticated, anon;

COMMENT ON FUNCTION public.search_streets(text, int, text) IS
  'HOR-410: street import picker typeahead over gnaf.street_localities. SECURITY DEFINER. Prefix-then-trgm ranked; optional p_locality_pid narrows to one suburb. Returns locality + postcode for disambiguation and address_count as a scope hint.';

-- ─── search_buildings ───────────────────────────────────────────────
-- Structural buildings: G-NAF has no materialised building_name, so the
-- agent searches by STREET name (optionally with the number in the
-- query) and we surface complexes on that street. The label the UI
-- renders is "<number> <street>, <suburb> (N units)".
--
-- We match the query against street_name (trigram/prefix). If the query
-- starts with a number, that leading token is also matched against
-- number_first so "10 Smith" narrows to number 10 on Smith St.
CREATE OR REPLACE FUNCTION public.search_buildings(
  p_q            text,
  p_limit        int  DEFAULT 10,
  p_locality_pid text DEFAULT NULL
)
RETURNS TABLE (
  complex_key         text,
  street_locality_pid text,
  number_first        text,
  street_name         text,
  street_type_code    text,
  locality_pid        text,
  locality_name       text,
  state_abbrev        text,
  postcode            text,
  unit_count          integer,
  address_count       integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, gnaf
AS $$
  WITH parsed AS (
    SELECT
      trim(p_q) AS q,
      -- leading number token, if any (e.g. "10" from "10 Smith St")
      (regexp_match(trim(p_q), '^(\d+)'))[1] AS num_tok,
      -- the rest of the query with any leading number stripped, for the
      -- street-name match ("Smith St" from "10 Smith St")
      trim(regexp_replace(trim(p_q), '^\d+\s*', '')) AS name_tok
  )
  SELECT c.complex_key,
         c.street_locality_pid,
         c.number_first,
         c.street_name,
         c.street_type_code,
         c.locality_pid,
         c.locality_name,
         c.state_abbrev,
         c.postcode,
         c.unit_count,
         c.address_count
  FROM gnaf.complexes c, parsed
  WHERE p_q IS NOT NULL
    AND length(parsed.q) >= 2
    AND (p_locality_pid IS NULL OR c.locality_pid = p_locality_pid)
    -- street-name match: use the name token if a leading number was
    -- stripped, else the whole query.
    AND (
      c.street_name ILIKE (CASE WHEN parsed.name_tok <> '' THEN parsed.name_tok ELSE parsed.q END) || '%'
      OR c.street_name % (CASE WHEN parsed.name_tok <> '' THEN parsed.name_tok ELSE parsed.q END)
    )
    -- if the query carried a leading number, require it to match
    AND (parsed.num_tok IS NULL OR c.number_first = parsed.num_tok)
  ORDER BY
    (parsed.num_tok IS NOT NULL AND c.number_first = parsed.num_tok) DESC, -- exact number first
    (c.street_name ILIKE coalesce(NULLIF(parsed.name_tok, ''), parsed.q) || '%') DESC,
    similarity(c.street_name, coalesce(NULLIF(parsed.name_tok, ''), parsed.q)) DESC,
    c.unit_count DESC,    -- bigger complexes first
    c.street_name,
    c.number_first
  LIMIT LEAST(coalesce(p_limit, 10), 50);
$$;

GRANT EXECUTE ON FUNCTION public.search_buildings(text, int, text) TO authenticated, anon;

COMMENT ON FUNCTION public.search_buildings(text, int, text) IS
  'HOR-410: building/complex import picker typeahead over gnaf.complexes. SECURITY DEFINER. Structural (no building_name): the agent searches by street (optionally prefixed with the number, e.g. "10 Smith St"). Returns unit_count + locality + postcode for disambiguation.';
