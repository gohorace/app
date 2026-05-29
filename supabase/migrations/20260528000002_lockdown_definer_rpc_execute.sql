-- ============================================================
-- SECURITY: lock down SECURITY DEFINER RPCs to service_role (2026-05-28)
--
-- Linter lints 0028/0029 reported that `anon` and `authenticated` can
-- EXECUTE a set of SECURITY DEFINER functions via /rest/v1/rpc/*. For
-- the functions below that is an EXPOSURE, not a design choice:
--
--   • get/store/delete_integration_secret  → read/write decrypted vault
--     secrets with the public anon key.
--   • consume_oauth_code / consume_refresh_token / resolve_api_token →
--     probe or consume auth tokens by hash.
--   • accept_workspace_invite              → join a workspace.
--   • archive/claim/import core-market fns  → mutate import state.
--
-- ── Root cause ──────────────────────────────────────────────
-- The first 7 were ALREADY meant to be service_role-only — their
-- migrations carry `REVOKE … FROM PUBLIC; GRANT … TO service_role`,
-- but those grants never landed on prod (same _migrations drift as the
-- gnaf RLS). The 3 OAuth/token functions were never locked in code.
--
-- Every one of these is called only via the service-role `admin`
-- client server-side (apps/web/src/lib/email/vault.ts, app/oauth/token/
-- route.ts, lib/mcp/auth.ts, app/auth/callback/*), so revoking
-- anon/authenticated EXECUTE matches actual usage and breaks nothing.
--
-- Idempotent: REVOKE is a no-op when the grant is already absent.
-- This does NOT touch the ~30 other DEFINER functions (tracker/embed
-- RPCs that are public by design, data-read RPCs, triggers) — those
-- need per-function classification before any grant change.
-- ============================================================

-- ─── Re-assert intended service_role-only lock (drifted open) ───────
REVOKE EXECUTE ON FUNCTION public.get_integration_secret(uuid)            FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_integration_secret(uuid)            TO service_role;

REVOKE EXECUTE ON FUNCTION public.store_integration_secret(text, text)    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.store_integration_secret(text, text)    TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_integration_secret(uuid)         FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.delete_integration_secret(uuid)         TO service_role;

REVOKE EXECUTE ON FUNCTION public.accept_workspace_invite(uuid, uuid)     FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.accept_workspace_invite(uuid, uuid)     TO service_role;

REVOKE EXECUTE ON FUNCTION public.archive_core_market(uuid, uuid)         FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.archive_core_market(uuid, uuid)         TO service_role;

REVOKE EXECUTE ON FUNCTION public.claim_core_market_import()              FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_core_market_import()              TO service_role;

REVOKE EXECUTE ON FUNCTION public.import_core_market_batch(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.import_core_market_batch(uuid, integer) TO service_role;

-- ─── New lock: OAuth / token functions (never restricted) ───────────
REVOKE EXECUTE ON FUNCTION public.consume_oauth_code(text)               FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_oauth_code(text)               TO service_role;

REVOKE EXECUTE ON FUNCTION public.consume_refresh_token(text)            FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_refresh_token(text)            TO service_role;

REVOKE EXECUTE ON FUNCTION public.resolve_api_token(text)                FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.resolve_api_token(text)                TO service_role;
