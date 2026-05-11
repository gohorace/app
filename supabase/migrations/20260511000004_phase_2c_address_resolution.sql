-- ============================================================
-- HOR-107  Phase 2c — address resolution + CSV import + read migration
--
-- 1. Relax properties.suburb / state / postcode to NULL-allowed.
--    Partial-address CSV imports (single "Address" line) need to
--    create a property row with just street_name + raw input. Listing
--    pages still write all four when scraping property metadata.
--
-- 2. resolve_residence_property() — canonical address upsert. Takes
--    optional components plus a raw fallback, normalises, hashes,
--    INSERT ... ON CONFLICT (workspace_id, address_hash). Returns the
--    property id. Used by Phase 2c CSV import; Phase 3 will reuse it
--    from the tracker beacon for listing pages.
--
-- 3. get_contacts_list() — LEFT JOIN properties via residence_property_id.
--    Returns property_address (concatenated) and suburb from the joined
--    row when present, falls back to legacy contacts columns otherwise.
--    Reader migration without breaking un-migrated rows.
-- ============================================================

-- ─── 1. Relax properties constraints ──────────────────────────────────────────

ALTER TABLE properties ALTER COLUMN suburb   DROP NOT NULL;
ALTER TABLE properties ALTER COLUMN state    DROP NOT NULL;
ALTER TABLE properties ALTER COLUMN postcode DROP NOT NULL;

COMMENT ON COLUMN properties.suburb IS
  'Indexed. Nullable for residence-only properties created from partial-address CSV imports; required when populated from listing pages.';

-- ─── 2. Address normalisation + resolution ────────────────────────────────────

-- normalize_address_part(text) — lowercase, strip punctuation, expand common
-- street abbreviations, collapse whitespace. Empty string in → empty string out;
-- null in → null out. Deterministic; safe to use as a hash input.
CREATE OR REPLACE FUNCTION normalize_address_part(p_raw text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_out text;
BEGIN
  IF p_raw IS NULL THEN RETURN NULL; END IF;

  v_out := lower(p_raw);

  -- Strip punctuation that doesn't carry meaning, keep alphanumerics + spaces.
  v_out := regexp_replace(v_out, '[.,/#!$%\^&*;:{}=\-_`~()''"]', ' ', 'g');

  -- Expand a few high-frequency abbreviations to canonical forms before they
  -- can drift across data sources. Word-boundary anchored to avoid mangling
  -- "stowed" or "rdale".
  v_out := regexp_replace(v_out, '\mst\M',  'street', 'g');
  v_out := regexp_replace(v_out, '\mrd\M',  'road',   'g');
  v_out := regexp_replace(v_out, '\mave\M', 'avenue', 'g');
  v_out := regexp_replace(v_out, '\mdr\M',  'drive',  'g');
  v_out := regexp_replace(v_out, '\mln\M',  'lane',   'g');
  v_out := regexp_replace(v_out, '\mct\M',  'court',  'g');
  v_out := regexp_replace(v_out, '\mpl\M',  'place',  'g');
  v_out := regexp_replace(v_out, '\mcres\M','crescent','g');
  v_out := regexp_replace(v_out, '\mpde\M', 'parade', 'g');
  v_out := regexp_replace(v_out, '\mhwy\M', 'highway','g');

  -- Collapse whitespace
  v_out := regexp_replace(v_out, '\s+', ' ', 'g');
  v_out := trim(v_out);

  RETURN v_out;
END;
$$;

-- compute_address_hash() — canonical hash for property dedup. Prefers
-- structured components; if all four are null but raw is set, hashes the
-- normalised raw string. Returns null when nothing useful is present so the
-- caller can skip property creation entirely.
CREATE OR REPLACE FUNCTION compute_address_hash(
  p_street_number text,
  p_street_name   text,
  p_suburb        text,
  p_state         text,
  p_postcode      text,
  p_raw           text
)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_canonical text;
BEGIN
  -- Structured path: any component populated → build canonical key.
  IF p_street_name IS NOT NULL OR p_suburb IS NOT NULL OR p_postcode IS NOT NULL THEN
    v_canonical := concat_ws(
      '|',
      coalesce(normalize_address_part(p_street_number), ''),
      coalesce(normalize_address_part(p_street_name),   ''),
      coalesce(normalize_address_part(p_suburb),        ''),
      coalesce(lower(trim(p_state)),                    ''),
      coalesce(trim(p_postcode),                        '')
    );
  ELSIF p_raw IS NOT NULL AND length(trim(p_raw)) > 0 THEN
    v_canonical := concat_ws('|', 'raw', normalize_address_part(p_raw));
  ELSE
    RETURN NULL;
  END IF;

  RETURN encode(extensions.digest(v_canonical, 'sha256'), 'hex');
END;
$$;

-- resolve_residence_property() — lookup-or-create. Returns the property id, or
-- NULL when there's nothing hashable. New rows are status='residence_only';
-- existing rows keep their status (a listing-promoted address stays listed).
CREATE OR REPLACE FUNCTION resolve_residence_property(
  p_workspace_id  uuid,
  p_street_number text DEFAULT NULL,
  p_street_name   text DEFAULT NULL,
  p_suburb        text DEFAULT NULL,
  p_state         text DEFAULT NULL,
  p_postcode      text DEFAULT NULL,
  p_raw           text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_id   uuid;
BEGIN
  v_hash := compute_address_hash(
    p_street_number, p_street_name, p_suburb, p_state, p_postcode, p_raw
  );

  IF v_hash IS NULL THEN
    RETURN NULL;
  END IF;

  -- Use the structured street_name if present, otherwise fall back to a
  -- placeholder derived from the raw line so the NOT NULL on street_name
  -- stays satisfied. The brief's "leave fields null when only single address
  -- line" guidance applies to suburb/state/postcode (now nullable);
  -- street_name carries the canonical address text for partial inputs.
  INSERT INTO properties (
    workspace_id, street_number, street_name, suburb, state, postcode,
    address_hash, status, first_seen_at, last_activity_at
  )
  VALUES (
    p_workspace_id,
    p_street_number,
    coalesce(p_street_name, p_raw, '(unknown)'),
    p_suburb,
    p_state,
    p_postcode,
    v_hash,
    'residence_only',
    now(),
    now()
  )
  ON CONFLICT (workspace_id, address_hash) WHERE deleted_at IS NULL DO UPDATE
    SET last_activity_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ─── 3. get_contacts_list — JOIN through residence_property_id ────────────────

DROP FUNCTION IF EXISTS get_contacts_list(uuid);

CREATE OR REPLACE FUNCTION get_contacts_list(p_agent_id uuid)
RETURNS TABLE (
  id                              uuid,
  first_name                      text,
  last_name                       text,
  email                           text,
  phone                           text,
  score                           int,
  score_change_7d                 int,
  last_seen_at                    timestamptz,
  property_address                text,
  suburb                          text,
  source                          text,
  medium                          text,
  session_count                   bigint,
  last_event_type                 text,
  last_page_title                 text,
  tracked_link_token              text,
  tracked_link_last_clicked_at    timestamptz,
  tracked_link_destination_url    text,
  is_stitched                     boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH agent_contacts AS (
    SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
           c.score, c.last_seen_at,
           c.property_address       AS legacy_property_address,
           c.suburb                 AS legacy_suburb,
           c.residence_property_id,
           c.source, c.medium
    FROM contacts c
    WHERE c.agent_id = p_agent_id
      AND c.deleted_at IS NULL
  ),
  residence AS (
    SELECT
      ac.id AS contact_id,
      -- Build a one-line address from the joined property's components.
      -- Phase 4 may format this differently per display surface; for now
      -- keep it server-side and predictable.
      trim(BOTH ', ' FROM concat_ws(', ',
        nullif(trim(concat_ws(' ', p.street_number, p.street_name)), ''),
        p.suburb,
        nullif(trim(concat_ws(' ', p.state, p.postcode)), '')
      )) AS resolved_address,
      p.suburb AS resolved_suburb
    FROM agent_contacts ac
    LEFT JOIN properties p
      ON  p.id = ac.residence_property_id
      AND p.deleted_at IS NULL
  ),
  contact_sessions AS (
    SELECT
      im.contact_id,
      COUNT(DISTINCT s.id) AS session_count
    FROM identity_map im
    JOIN sessions s
      ON  s.workspace_id = im.workspace_id
      AND s.anonymous_id = im.anonymous_id
    WHERE im.contact_id IN (SELECT id FROM agent_contacts)
    GROUP BY im.contact_id
  ),
  last_page AS (
    SELECT DISTINCT ON (im.contact_id)
      im.contact_id,
      e.event_type,
      e.properties->>'title' AS page_title
    FROM identity_map im
    JOIN sessions s
      ON  s.workspace_id = im.workspace_id
      AND s.anonymous_id = im.anonymous_id
    JOIN events e ON e.session_id = s.id
    WHERE im.contact_id IN (SELECT id FROM agent_contacts)
      AND e.event_type IN ('page_view', 'property_view', 'form_submit')
    ORDER BY im.contact_id, e.occurred_at DESC
  ),
  score_7d AS (
    SELECT
      sh.contact_id,
      COALESCE(SUM(sh.delta), 0)::int AS score_change
    FROM score_history sh
    WHERE sh.agent_id   = p_agent_id
      AND sh.occurred_at >= now() - interval '7 days'
    GROUP BY sh.contact_id
  ),
  stitched AS (
    SELECT DISTINCT im.contact_id
    FROM identity_map im
    WHERE im.agent_id = p_agent_id
  )
  SELECT
    ac.id,
    ac.first_name,
    ac.last_name,
    ac.email,
    ac.phone,
    ac.score,
    COALESCE(s7.score_change, 0)                                 AS score_change_7d,
    ac.last_seen_at,
    COALESCE(NULLIF(r.resolved_address, ''), ac.legacy_property_address) AS property_address,
    COALESCE(r.resolved_suburb,           ac.legacy_suburb)              AS suburb,
    ac.source,
    ac.medium,
    COALESCE(cs.session_count, 0)                                AS session_count,
    lp.event_type                                                AS last_event_type,
    lp.page_title                                                AS last_page_title,
    ctl.token                                                    AS tracked_link_token,
    ctl.last_clicked_at                                          AS tracked_link_last_clicked_at,
    ctl.destination_url                                          AS tracked_link_destination_url,
    (st.contact_id IS NOT NULL)                                  AS is_stitched
  FROM agent_contacts ac
  LEFT JOIN residence              r   ON r.contact_id   = ac.id
  LEFT JOIN contact_sessions       cs  ON cs.contact_id  = ac.id
  LEFT JOIN last_page              lp  ON lp.contact_id  = ac.id
  LEFT JOIN score_7d               s7  ON s7.contact_id  = ac.id
  LEFT JOIN contact_tracked_links  ctl ON ctl.contact_id = ac.id
  LEFT JOIN stitched               st  ON st.contact_id  = ac.id
  ORDER BY ac.score DESC, cs.session_count DESC NULLS LAST
  LIMIT 500;
$$;
