-- ============================================================
-- HOR-385 (P1) — Crawled site-content store
--
-- Per-agent index of the three content types the outreach drafter pulls
-- from: active listings, sold results, suburb reports. `properties` holds
-- the canonical address row (shared with Core Markets G-NAF data) but can't
-- hold the marketing payload (hero image, price text, bed/bath/car, listed
-- date) or suburb reports — that lives here.
--
-- Listings/sold reconcile into `properties` by address_hash so we don't
-- duplicate G-NAF rows and so events.property_id joins to the crawled listing
-- (P3 matching). Hashing stays in SQL (compute_address_hash, 20260511000004)
-- so a crawled address produces the identical hash to the importer's.
--
-- Sovereignty: per-workspace RLS, exportable, deletable — same shape as every
-- other workspace-scoped table.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_site_content (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id        uuid NOT NULL REFERENCES agents(id)     ON DELETE CASCADE,
  content_type    text NOT NULL
    CHECK (content_type IN ('listing', 'sold', 'suburb_report')),
  -- Canonical property row for listing/sold (NULL when the page lacked a
  -- structured address, or for suburb reports).
  property_id     uuid REFERENCES properties(id) ON DELETE SET NULL,
  source_url      text NOT NULL,
  suburb          text,
  locality_key    text,            -- G-NAF locality_pid where resolvable
  -- Marketing payload (the brief's required fields).
  address         text,
  price_text      text,
  bed             integer,
  bath            integer,
  car             integer,
  hero_image_url  text,
  sold_price_text text,
  sold_date       date,
  listed_date     date,
  title           text,            -- suburb-report title
  published_date  date,            -- suburb-report published date
  -- Freshness (HOR-386 reads/maintains these; set on every crawl here).
  last_crawled_at  timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  last_http_status integer,
  still_active     boolean,        -- listings: still live on the source page
  raw             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_url)
);

-- Matching (P3) queries by agent + type + suburb, freshest first.
CREATE INDEX IF NOT EXISTS agent_site_content_match_idx
  ON agent_site_content (agent_id, content_type, suburb, last_crawled_at DESC);

-- Join from a viewed property to its crawled listing.
CREATE INDEX IF NOT EXISTS agent_site_content_property_idx
  ON agent_site_content (property_id)
  WHERE property_id IS NOT NULL;

ALTER TABLE agent_site_content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_site_content_select" ON agent_site_content;
CREATE POLICY "agent_site_content_select" ON agent_site_content
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

-- ─── Upsert RPC ─────────────────────────────────────────────────────
-- Single atomic write per crawled page: reconcile the property (listing/sold,
-- when a structured address is present) then upsert the content row. The
-- route passes parsed fields as a jsonb payload so this signature stays stable
-- as extraction improves.
--
-- Payload keys (all optional unless noted):
--   content_type (required: 'listing'|'sold'|'suburb_report')
--   source_url   (required)
--   suburb, address, street_number, street_name, state, postcode
--   price_text, bed, bath, car, hero_image_url
--   sold_price_text, sold_date, listed_date, title, published_date
--   http_status, still_active, raw
CREATE OR REPLACE FUNCTION public.upsert_agent_site_content(
  p_workspace_id uuid,
  p_agent_id     uuid,
  p_payload      jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, gnaf
AS $$
DECLARE
  v_type        text := p_payload->>'content_type';
  v_source_url  text := p_payload->>'source_url';
  v_suburb      text := nullif(trim(coalesce(p_payload->>'suburb', '')), '');
  v_state       text := nullif(trim(coalesce(p_payload->>'state', '')), '');
  v_street_name text := nullif(trim(coalesce(p_payload->>'street_name', '')), '');
  v_hash        text;
  v_property_id uuid;
  v_locality    text;
  v_content_id  uuid;
BEGIN
  IF v_type IS NULL OR v_source_url IS NULL OR length(trim(v_source_url)) = 0 THEN
    RAISE EXCEPTION 'upsert_agent_site_content: content_type and source_url are required';
  END IF;

  -- 1. Reconcile the property for listing/sold when we have enough address to
  --    hash. Same compute_address_hash() the G-NAF importer uses → matches,
  --    never duplicates. status: 'sold' for sold results, 'listed' otherwise
  --    (both stronger than the importer's 'watching').
  IF v_type IN ('listing', 'sold') AND v_street_name IS NOT NULL AND v_suburb IS NOT NULL THEN
    v_hash := compute_address_hash(
      nullif(trim(coalesce(p_payload->>'street_number', '')), ''),
      v_street_name, v_suburb, v_state,
      nullif(trim(coalesce(p_payload->>'postcode', '')), ''),
      NULL
    );

    IF v_hash IS NOT NULL THEN
      INSERT INTO properties (
        workspace_id, street_number, street_name, suburb, state, postcode,
        address_hash, listing_agent_id, status, first_seen_at, last_activity_at
      )
      VALUES (
        p_workspace_id,
        nullif(trim(coalesce(p_payload->>'street_number', '')), ''),
        v_street_name, v_suburb, v_state,
        nullif(trim(coalesce(p_payload->>'postcode', '')), ''),
        v_hash, p_agent_id,
        CASE WHEN v_type = 'sold' THEN 'sold' ELSE 'listed' END,
        now(), now()
      )
      ON CONFLICT (workspace_id, address_hash) WHERE deleted_at IS NULL DO UPDATE
        SET status           = CASE WHEN v_type = 'sold' THEN 'sold' ELSE 'listed' END,
            listing_agent_id = COALESCE(properties.listing_agent_id, EXCLUDED.listing_agent_id),
            last_activity_at = now()
      RETURNING id INTO v_property_id;
    END IF;
  END IF;

  -- 2. Best-effort G-NAF locality resolution for suburb-scoped matching (P3).
  IF v_suburb IS NOT NULL THEN
    SELECT l.locality_pid INTO v_locality
      FROM gnaf.localities l
     WHERE lower(l.locality_name) = lower(v_suburb)
       AND (v_state IS NULL OR l.state_abbrev = upper(v_state))
     ORDER BY l.state_abbrev
     LIMIT 1;
  END IF;

  -- 3. Upsert the content row (one per source URL).
  INSERT INTO agent_site_content (
    workspace_id, agent_id, content_type, property_id, source_url,
    suburb, locality_key, address, price_text, bed, bath, car, hero_image_url,
    sold_price_text, sold_date, listed_date, title, published_date,
    last_crawled_at, last_verified_at, last_http_status, still_active, raw
  )
  VALUES (
    p_workspace_id, p_agent_id, v_type, v_property_id, trim(v_source_url),
    v_suburb, v_locality,
    nullif(trim(coalesce(p_payload->>'address', '')), ''),
    nullif(trim(coalesce(p_payload->>'price_text', '')), ''),
    (p_payload->>'bed')::int, (p_payload->>'bath')::int, (p_payload->>'car')::int,
    nullif(trim(coalesce(p_payload->>'hero_image_url', '')), ''),
    nullif(trim(coalesce(p_payload->>'sold_price_text', '')), ''),
    (p_payload->>'sold_date')::date,
    (p_payload->>'listed_date')::date,
    nullif(trim(coalesce(p_payload->>'title', '')), ''),
    (p_payload->>'published_date')::date,
    now(), now(),
    (p_payload->>'http_status')::int,
    (p_payload->>'still_active')::boolean,
    COALESCE(p_payload->'raw', '{}'::jsonb)
  )
  ON CONFLICT (workspace_id, source_url) DO UPDATE
    SET content_type     = EXCLUDED.content_type,
        property_id      = COALESCE(EXCLUDED.property_id, agent_site_content.property_id),
        suburb           = EXCLUDED.suburb,
        locality_key     = EXCLUDED.locality_key,
        address          = EXCLUDED.address,
        price_text       = EXCLUDED.price_text,
        bed              = EXCLUDED.bed,
        bath             = EXCLUDED.bath,
        car              = EXCLUDED.car,
        hero_image_url   = EXCLUDED.hero_image_url,
        sold_price_text  = EXCLUDED.sold_price_text,
        sold_date        = EXCLUDED.sold_date,
        listed_date      = EXCLUDED.listed_date,
        title            = EXCLUDED.title,
        published_date   = EXCLUDED.published_date,
        last_crawled_at  = now(),
        last_verified_at = now(),
        last_http_status = EXCLUDED.last_http_status,
        still_active     = EXCLUDED.still_active,
        raw              = EXCLUDED.raw,
        updated_at       = now()
  RETURNING id INTO v_content_id;

  RETURN v_content_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_agent_site_content(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_agent_site_content(uuid, uuid, jsonb) TO service_role;
