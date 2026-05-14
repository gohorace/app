-- ============================================================
-- Hotfix — generate_inbound_local_part() unqualified pgcrypto call
--
-- Follows the same fix pattern as 20260510000003: pgcrypto lives in
-- the `extensions` schema on Supabase, and SECURITY DEFINER /
-- trigger-context functions don't have `extensions` on their
-- search_path. Unqualified `gen_random_bytes()` calls there fail:
--
--   function gen_random_bytes(integer) does not exist
--
-- The original 20260510000003 patch caught two offenders
-- (generate_campaign_tokens, generate_tracked_link_token) but
-- generate_inbound_local_part() was introduced AFTER that fix in
-- 20260510000009 with the same unqualified pattern.
--
-- Symptom: signup → /onboarding → create_workspace_with_agent →
-- INSERT INTO agents → AFTER INSERT trigger agents_create_inbound_
-- address_trg → generate_inbound_local_part() → 42883. Whole insert
-- rolls back, surface error: "Failed to set up workspace."
--
-- Fix: re-emit the function with extensions.gen_random_bytes(10).
-- Idempotent (CREATE OR REPLACE); no data migration required.
--
-- Not strictly part of HOR-56 but discovered during HOR-56 preview
-- smoke testing. Riding along on the same branch to unblock the
-- test cycle; safe to cherry-pick to main independently if needed.
-- ============================================================

CREATE OR REPLACE FUNCTION generate_inbound_local_part()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  -- 31 unambiguous chars (0/1/i/l/o stripped). 31^10 ≈ 8.2 × 10^14 → plenty of entropy.
  alphabet constant text := '23456789abcdefghjkmnpqrstuvwxyz';
  result text := '';
  bytes  bytea;
  i      int;
BEGIN
  bytes := extensions.gen_random_bytes(10);
  FOR i IN 1..10 LOOP
    result := result || substr(alphabet, 1 + (get_byte(bytes, i - 1) % length(alphabet)), 1);
  END LOOP;
  RETURN result;
END;
$$;
