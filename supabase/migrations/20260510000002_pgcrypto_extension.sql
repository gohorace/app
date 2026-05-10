-- ============================================================
-- Ensure pgcrypto is installed in the public schema so that
-- functions calling gen_random_bytes() (e.g. generate_campaign_tokens
-- and the contacts insert path) resolve regardless of search_path.
--
-- Without this, CSV imports and any code path that ends up needing
-- gen_random_bytes() fails with: "function gen_random_bytes(integer)
-- does not exist".
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
