-- ============================================================
-- HOR-224 / HOR-106 — integration_secrets SECURITY DEFINER wrappers
--
-- Slice B of HOR-106. Slice A added agent_integrations.vault_secret_id
-- (a pointer to a row in vault.secrets). PostgREST does not expose the
-- vault schema, so server code cannot read vault.decrypted_secrets or
-- write vault.secrets via the Supabase client directly.
--
-- This migration exposes three narrow wrappers, all SECURITY DEFINER
-- with search_path locked, granted only to service_role:
--
--   * store_integration_secret(payload, name)  → uuid
--   * get_integration_secret(secret_id)        → text
--   * delete_integration_secret(secret_id)     → boolean
--
-- Payload is the refresh_token (string). Access tokens are never
-- persisted — they live in process memory only (see lib/email/integrations.ts).
-- Refresh-token rotation is handled by delete+store rather than update;
-- agent_integrations.vault_secret_id gets re-pointed to the new row.
--
-- ⚠️ Migration drift active (HOR-131): apply via Supabase Studio SQL
--    editor + manual
--      INSERT INTO supabase_migrations.schema_migrations
--        (version) VALUES ('20260519000002');
--    Do NOT `supabase db push`.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- store_integration_secret
-- ------------------------------------------------------------
-- Thin wrapper over vault.create_secret. Pattern: pg_cron_core_markets
-- (`20260517000011_pg_cron_core_markets.sql`).
CREATE OR REPLACE FUNCTION public.store_integration_secret(
  p_secret_text text,
  p_name        text
) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT vault.create_secret(p_secret_text, p_name);
$$;

REVOKE ALL ON FUNCTION public.store_integration_secret(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_integration_secret(text, text) TO service_role;

-- ------------------------------------------------------------
-- get_integration_secret
-- ------------------------------------------------------------
-- Reads vault.decrypted_secrets by id and returns the decrypted payload.
-- STABLE because it doesn't modify state. Only service_role may call.
-- Returns NULL if the secret has been deleted (caller treats that as
-- "integration in revoked/disconnected state").
CREATE OR REPLACE FUNCTION public.get_integration_secret(p_secret_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE id = p_secret_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_integration_secret(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_integration_secret(uuid) TO service_role;

-- ------------------------------------------------------------
-- delete_integration_secret
-- ------------------------------------------------------------
-- Removes the row from vault.secrets. Returns TRUE if a row was deleted,
-- FALSE if no row matched. Caller (disconnect route) tolerates FALSE —
-- it just means the secret was already gone.
CREATE OR REPLACE FUNCTION public.delete_integration_secret(p_secret_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE
  v_count int;
BEGIN
  DELETE FROM vault.secrets WHERE id = p_secret_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END $$;

REVOKE ALL ON FUNCTION public.delete_integration_secret(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_integration_secret(uuid) TO service_role;

COMMIT;
