-- ============================================================
-- 20260528000001_lint_security_fixes.sql — catalog assertions
--
-- Verifies the linter-error remediation landed:
--   1. RLS enabled on gnaf.localities and gnaf.address_principal.
--   2. public.inbound_emails_unresolved has security_invoker = true.
--
-- Run via the Supabase Studio SQL editor (admin / service-role context)
-- AFTER the migration is applied. Pure catalog reads — no fixture data,
-- but wrapped in BEGIN … ROLLBACK to match the suite convention.
--
-- No pgTAP installed (matches portal_enquiry_capture.spec.sql) — DO
-- block with RAISE EXCEPTION on failure, RAISE NOTICE on pass.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_loc_rls   boolean;
  v_addr_rls  boolean;
  v_invoker   boolean;
BEGIN

  -- ══════════════════════════════════════════════════════════
  -- 1. RLS enabled on both gnaf tables.
  -- ══════════════════════════════════════════════════════════
  SELECT c.relrowsecurity INTO v_loc_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'gnaf' AND c.relname = 'localities';

  SELECT c.relrowsecurity INTO v_addr_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'gnaf' AND c.relname = 'address_principal';

  IF v_loc_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 1a: RLS not enabled on gnaf.localities';
  END IF;
  IF v_addr_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 1b: RLS not enabled on gnaf.address_principal';
  END IF;
  RAISE NOTICE 'PASS 1: RLS enabled on gnaf.localities and gnaf.address_principal';

  -- ══════════════════════════════════════════════════════════
  -- 2. inbound_emails_unresolved is security_invoker.
  --    reloptions holds 'security_invoker=true' when set.
  -- ══════════════════════════════════════════════════════════
  SELECT EXISTS (
    SELECT 1
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'inbound_emails_unresolved'
      AND c.reloptions @> ARRAY['security_invoker=true']
  ) INTO v_invoker;

  IF v_invoker IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 2: public.inbound_emails_unresolved is not security_invoker';
  END IF;
  RAISE NOTICE 'PASS 2: public.inbound_emails_unresolved is security_invoker = true';

  RAISE NOTICE 'ALL LINT SECURITY FIX ASSERTIONS PASSED';
END $$;

ROLLBACK;
