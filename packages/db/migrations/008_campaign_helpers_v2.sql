-- ============================================================
-- Migration 008: Campaign Helper Functions v2
-- Replaces functions from migration 004.
--
-- Changes from v1:
--   - resolve_campaign_token now accepts p_workspace_id,
--     p_agent_id, and p_anonymous_id so it can write an
--     identity_map entry on first click (previously it only
--     returned the contact_id with no side-effects beyond
--     recording clicked_at).
--   - generate_campaign_tokens signature drops p_org_id and
--     uses p_agent_id instead, matching the new schema.
-- ============================================================

-- ============================================================
-- FUNCTION: Resolve a campaign token
-- Marks the token as clicked (idempotent) and, when an
-- anonymous_id is supplied, stitches the visitor to the contact
-- via identity_map using the 'email_click' method.
-- Returns the contact_id, or NULL if the token is not found.
-- Called by the tracking endpoint via the service role.
-- ============================================================

CREATE OR REPLACE FUNCTION resolve_campaign_token(
  p_workspace_id uuid,
  p_agent_id     uuid,
  p_token        text,
  p_anonymous_id text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_contact_id uuid;
BEGIN
  -- Record first click time; return the associated contact
  UPDATE campaign_tokens
  SET clicked_at = COALESCE(clicked_at, now())
  WHERE token    = p_token
    AND agent_id = p_agent_id
  RETURNING contact_id INTO v_contact_id;

  -- Stitch anonymous visitor to contact when anonymous_id is known
  IF v_contact_id IS NOT NULL AND p_anonymous_id IS NOT NULL THEN
    INSERT INTO identity_map
      (workspace_id, agent_id, anonymous_id, contact_id, stitch_method, confidence)
    VALUES
      (p_workspace_id, p_agent_id, p_anonymous_id, v_contact_id, 'email_click', 'high')
    ON CONFLICT (workspace_id, agent_id, anonymous_id) DO NOTHING;
  END IF;

  RETURN v_contact_id;
END;
$$;

-- ============================================================
-- FUNCTION: Generate campaign tokens for multiple contacts
-- Inserts one token per contact; skips contacts that already
-- have a token for the given campaign (ON CONFLICT DO NOTHING).
-- Returns the number of rows processed (not necessarily inserted).
-- ============================================================

CREATE OR REPLACE FUNCTION generate_campaign_tokens(
  p_agent_id    uuid,
  p_campaign_id uuid,
  p_contact_ids uuid[]
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_cid   uuid;
  v_token text;
BEGIN
  FOREACH v_cid IN ARRAY p_contact_ids LOOP
    -- Generate a 12-char URL-safe token from 9 random bytes
    v_token := substring(encode(gen_random_bytes(9), 'base64') FROM 1 FOR 12);
    v_token := replace(replace(replace(v_token, '+', 'A'), '/', 'B'), '=', 'C');

    INSERT INTO campaign_tokens (agent_id, campaign_id, contact_id, token)
    VALUES (p_agent_id, p_campaign_id, v_cid, v_token)
    ON CONFLICT (campaign_id, contact_id) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
