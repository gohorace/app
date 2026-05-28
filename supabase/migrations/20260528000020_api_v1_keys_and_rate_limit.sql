-- HOR-322 · Public API v1 — agency keys + Postgres token-bucket rate limit
--
-- Builds on the existing workspace_api_tokens table (which already backs MCP
-- `hor_` tokens). Phase 2 adds:
--   • a `kind` discriminator so the v1 surface only accepts keys minted as
--     `api_v1` (`hra_live_…`) — MCP `hor_` tokens stay mcp-only.
--   • `last_used_ip` so the settings UI can show where a key was last used.
--   • resolve_api_v1_token(): kind-gated resolver that stamps last_used_at +
--     last_used_ip. resolve_api_token() (MCP) is left UNTOUCHED.
--   • rate_limit_buckets + consume_rate_token(): per-workspace fixed-window
--     limiter — 600/min and a 10/s burst guard, across all of an agency's keys.
--
-- ⚠️ Migration drift: apply via Studio SQL editor + manual INSERT of
-- '20260528000020', NOT `supabase db push`, until HOR-131. See
-- ~/.claude/projects/-Users-andytwomey-code/memory/horace_migration_tracking_drift.md.

BEGIN;

-- ============================================================
-- A. workspace_api_tokens — kind + last_used_ip
-- ============================================================

ALTER TABLE workspace_api_tokens
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'mcp'
    CHECK (kind IN ('mcp', 'api_v1')),
  ADD COLUMN IF NOT EXISTS last_used_ip text,
  -- Last 4 chars of the plaintext, captured at mint, for masked UI display
  -- (e.g. "hra_live_…a1b2"). The plaintext itself is never stored.
  ADD COLUMN IF NOT EXISTS key_hint text;

-- Active-token lookup, scoped by kind (the v1 resolver filters on it).
CREATE INDEX IF NOT EXISTS workspace_api_tokens_kind_active_idx
  ON workspace_api_tokens (kind, token_hash)
  WHERE revoked_at IS NULL;

-- ============================================================
-- B. resolve_api_v1_token — kind-gated resolver (stamps last_used_at + ip)
--
-- Separate from resolve_api_token() so the MCP path is untouched. Returns the
-- workspace + the minting agent (kept for parity / future per-agent attribution;
-- the v1 API itself reads agency-wide).
-- ============================================================

CREATE OR REPLACE FUNCTION public.resolve_api_v1_token(
  p_token_hash text,
  p_source_ip  text DEFAULT NULL
)
RETURNS TABLE (workspace_id uuid, agent_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE workspace_api_tokens
  SET    last_used_at = now(),
         last_used_ip = COALESCE(p_source_ip, last_used_ip)
  WHERE  token_hash = p_token_hash
    AND  revoked_at IS NULL
    AND  kind = 'api_v1'
  RETURNING workspace_api_tokens.workspace_id, workspace_api_tokens.agent_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_api_v1_token(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_api_v1_token(text, text) TO service_role;

COMMENT ON FUNCTION public.resolve_api_v1_token(text, text) IS
  'HOR-322: resolve an hra_live_ (kind=api_v1) bearer token to its workspace, stamping last_used_at + last_used_ip. service_role only.';

-- ============================================================
-- C. Rate limiting — per-workspace fixed windows (minute + second)
--
-- 600 requests/min per agency + a 10 req/s burst guard, across all keys.
-- A token bucket would allow a 600-wide burst; two fixed windows keep the
-- per-second ceiling honest while reporting the minute window in the headers.
-- ============================================================

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bucket_key   text        NOT NULL CHECK (bucket_key IN ('minute', 'second')),
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, bucket_key, window_start)
);

ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;
-- No policies: only the SECURITY DEFINER limiter (service role) touches it.

-- consume_rate_token: increment this workspace's minute + second counters and
-- report the verdict + the minute-window headers. allowed=false when either
-- ceiling is breached. Counters increment even on rejection (standard).
CREATE OR REPLACE FUNCTION public.consume_rate_token(p_workspace_id uuid)
RETURNS TABLE (
  allowed       boolean,
  limit_per_min integer,
  remaining     integer,
  reset_epoch   bigint,
  retry_after   integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_minute_start timestamptz := date_trunc('minute', now());
  v_second_start timestamptz := date_trunc('second', now());
  v_minute_count integer;
  v_second_count integer;
  v_minute_limit constant integer := 600;
  v_second_limit constant integer := 10;
BEGIN
  -- Opportunistic cleanup of this workspace's stale windows (cheap, bounded).
  DELETE FROM rate_limit_buckets
   WHERE workspace_id = p_workspace_id
     AND window_start < now() - interval '5 minutes';

  INSERT INTO rate_limit_buckets (workspace_id, bucket_key, window_start, count)
  VALUES (p_workspace_id, 'minute', v_minute_start, 1)
  ON CONFLICT (workspace_id, bucket_key, window_start)
    DO UPDATE SET count = rate_limit_buckets.count + 1
  RETURNING count INTO v_minute_count;

  INSERT INTO rate_limit_buckets (workspace_id, bucket_key, window_start, count)
  VALUES (p_workspace_id, 'second', v_second_start, 1)
  ON CONFLICT (workspace_id, bucket_key, window_start)
    DO UPDATE SET count = rate_limit_buckets.count + 1
  RETURNING count INTO v_second_count;

  limit_per_min := v_minute_limit;
  remaining     := greatest(v_minute_limit - v_minute_count, 0);
  reset_epoch   := extract(epoch FROM v_minute_start + interval '1 minute')::bigint;

  IF v_second_count > v_second_limit THEN
    allowed := false;
    retry_after := 1;
  ELSIF v_minute_count > v_minute_limit THEN
    allowed := false;
    retry_after := ceil(extract(epoch FROM (v_minute_start + interval '1 minute' - now())))::int;
  ELSE
    allowed := true;
    retry_after := 0;
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_token(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_token(uuid) TO service_role;

COMMENT ON TABLE rate_limit_buckets IS
  'HOR-322: per-workspace fixed-window request counters for the public API rate limit. Maintained by consume_rate_token().';
COMMENT ON FUNCTION public.consume_rate_token(uuid) IS
  'HOR-322: increment a workspace''s minute+second request counters and return the rate-limit verdict + minute-window headers. service_role only.';

COMMIT;
