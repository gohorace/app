-- ============================================================
-- Migration 004: Campaign Token Helpers
-- ============================================================

-- ============================================================
-- FUNCTION: Resolve a campaign token during tracking ingestion
-- Returns the contact_id associated with the token, or NULL.
-- Also records clicked_at on first use.
-- (Called by the tracking endpoint via service role)
-- ============================================================

CREATE OR REPLACE FUNCTION resolve_campaign_token(
  p_org_id uuid,
  p_token  text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_id uuid;
BEGIN
  UPDATE campaign_tokens
  SET clicked_at = COALESCE(clicked_at, now())
  WHERE token = p_token
    AND org_id = p_org_id
  RETURNING contact_id INTO v_contact_id;

  RETURN v_contact_id;
END;
$$;

-- ============================================================
-- FUNCTION: Generate campaign tokens for multiple contacts
-- Returns the number of tokens created.
-- ============================================================

CREATE OR REPLACE FUNCTION generate_campaign_tokens(
  p_org_id      uuid,
  p_campaign_id uuid,
  p_contact_ids uuid[]
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count  int := 0;
  v_cid    uuid;
  v_token  text;
BEGIN
  FOREACH v_cid IN ARRAY p_contact_ids LOOP
    -- Generate a 12-char base62-ish token using MD5 (server-side fallback)
    -- The application layer also does this; this function is for bulk ops
    v_token := substring(encode(gen_random_bytes(9), 'base64') FROM 1 FOR 12);
    v_token := replace(replace(replace(v_token, '+', 'A'), '/', 'B'), '=', 'C');

    INSERT INTO campaign_tokens (org_id, campaign_id, contact_id, token)
    VALUES (p_org_id, p_campaign_id, v_cid, v_token)
    ON CONFLICT (campaign_id, contact_id) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
