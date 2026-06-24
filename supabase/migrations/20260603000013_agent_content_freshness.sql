-- ============================================================
-- HOR-386 (P2) — Content freshness
--
-- The trust-critical gate: no stale price, sold-but-still-listed property, or
-- dead link reaches a draft. Two layers:
--
--   1. fresh_agent_site_content — the candidate VIEW P3 selects from. A row is
--      a candidate only if its last check was 200, it was touched within 14
--      days, sold rows have a sold_date, and listings are still_active. Bias to
--      omission: anything failing simply isn't a candidate.
--
--   2. reconcile_crawl_delistings — called when a full crawl COMPLETES. Any
--      listing row the crawl didn't re-touch (gone from the sitemap) is marked
--      still_active=false → de-listings drop out of the pool without a separate
--      verify pass. The just-in-time re-verify at draft time (lib/outreach/
--      freshness.ts) is the second backstop on the 1–5 URLs actually inserted.
--
-- Freshness window is GREATEST(last_crawled_at, last_verified_at) so a draft-
-- time verify keeps a still-listed item fresh even between nightly recrawls.
-- ============================================================

CREATE OR REPLACE VIEW public.fresh_agent_site_content
WITH (security_invoker = true) AS
  SELECT *
    FROM public.agent_site_content c
   WHERE c.last_http_status = 200
     AND GREATEST(c.last_crawled_at, COALESCE(c.last_verified_at, c.last_crawled_at))
           > now() - interval '14 days'
     AND (c.content_type <> 'sold'    OR c.sold_date IS NOT NULL)
     AND (c.content_type <> 'listing' OR c.still_active IS TRUE);

-- Mark de-listed listings inactive after a completed crawl. A listing row whose
-- last_verified_at predates this crawl run wasn't in the sitemap → de-listed.
-- Only call this when the crawl completed with a healthy URL count (the route
-- guards on total_urls > 0) so a partial/failed crawl can't false-positive.
CREATE OR REPLACE FUNCTION public.reconcile_crawl_delistings(
  p_agent_id         uuid,
  p_crawl_started_at timestamptz
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE agent_site_content
     SET still_active = false,
         updated_at   = now()
   WHERE agent_id = p_agent_id
     AND content_type = 'listing'
     AND still_active IS DISTINCT FROM false
     AND last_verified_at < p_crawl_started_at;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_crawl_delistings(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_crawl_delistings(uuid, timestamptz) TO service_role;
