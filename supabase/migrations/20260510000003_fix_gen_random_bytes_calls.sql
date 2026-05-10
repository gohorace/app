-- ============================================================
-- Fix unqualified gen_random_bytes() calls
--
-- pgcrypto lives in the `extensions` schema on Supabase. Functions
-- that have SET search_path = public (or are called from trigger
-- handlers that do) can't resolve gen_random_bytes() without an
-- explicit `extensions.` prefix. The result is the runtime error:
--
--   function gen_random_bytes(integer) does not exist
--
-- Fixing the leaf functions is the most surgical option — it doesn't
-- depend on every caller adding `extensions` to their search_path.
--
-- Note: `generate_tracked_link_token()` (and its trigger
-- `contacts_tracked_link_insert` + the `contact_tracked_links` table)
-- exists in production but was added via the Supabase dashboard, not
-- through this migrations folder. This migration recreates only the
-- function so a fresh DB cloned from these migrations won't fail the
-- same way. Capturing the trigger + table is a separate clean-up.
-- ============================================================

-- ----------------------------------------------------------------
-- generate_campaign_tokens (HOR-26 era; in migration 005)
-- ----------------------------------------------------------------
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
    v_token := substring(encode(extensions.gen_random_bytes(9), 'base64') FROM 1 FOR 12);
    v_token := replace(replace(replace(v_token, '+', 'A'), '/', 'B'), '=', 'C');

    INSERT INTO campaign_tokens (agent_id, campaign_id, contact_id, token)
    VALUES (p_agent_id, p_campaign_id, v_cid, v_token)
    ON CONFLICT (campaign_id, contact_id) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ----------------------------------------------------------------
-- generate_tracked_link_token (added via Supabase dashboard;
-- now captured here so fresh DBs have the corrected version)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_tracked_link_token()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_token text;
BEGIN
  v_token := substring(encode(extensions.gen_random_bytes(9), 'base64') FROM 1 FOR 12);
  v_token := replace(replace(replace(v_token, '+', 'A'), '/', 'B'), '=', 'C');
  RETURN v_token;
END;
$$;
