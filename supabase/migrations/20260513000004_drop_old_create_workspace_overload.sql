-- ============================================================
-- Drop the pre-HOR-47 (6-arg) overload of create_workspace_with_agent.
--
-- 20260510000001_onboarding_state.sql added a 7-arg version that accepts
-- p_phone, but did so via CREATE OR REPLACE — which in Postgres only
-- replaces a function when the argument list matches. Adding a parameter
-- created a new overload alongside the old one. Both have remained in
-- the database.
--
-- /api/orgs calls the function with 6 args (no phone). PostgREST then
-- raises PGRST203: it can't choose between the two equally-valid
-- candidates. Result: signup returns "Failed to create workspace".
--
-- Fix: drop the 6-arg overload. The remaining 7-arg version defaults
-- p_phone to NULL, so 6-arg-style call sites resolve to it.
-- ============================================================

DROP FUNCTION IF EXISTS public.create_workspace_with_agent(
  uuid, text, text, text, text, text
);
