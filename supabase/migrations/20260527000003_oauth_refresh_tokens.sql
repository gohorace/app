-- ============================================================
-- Migration: OAuth refresh tokens
-- Adds rotating, long-lived refresh tokens so MCP connections
-- survive past the (now short) access-token lifetime without a
-- manual reconnect.
--
-- Access tokens stay in workspace_api_tokens (client_id, expires_at,
-- scope). Refresh tokens live here and are single-use: each /oauth/token
-- refresh_token grant revokes the presented token and issues a fresh one
-- (OAuth 2.1 rotation BCP). rotated_from links the chain for audit.
-- ============================================================

CREATE TABLE oauth_refresh_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    text NOT NULL UNIQUE,
  client_id     text NOT NULL,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id      uuid NOT NULL REFERENCES agents(id)     ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scope         text NOT NULL DEFAULT 'mcp',
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  rotated_from  uuid REFERENCES oauth_refresh_tokens(id) ON DELETE SET NULL,
  last_used_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Hot path: look up an active token by hash.
CREATE INDEX oauth_refresh_tokens_active_idx
  ON oauth_refresh_tokens(token_hash)
  WHERE revoked_at IS NULL;
CREATE INDEX oauth_refresh_tokens_user_id_idx ON oauth_refresh_tokens(user_id);

ALTER TABLE oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;

-- Owner can list/revoke their own refresh tokens; lookup-by-hash happens
-- server-side via service role and bypasses RLS (mirrors workspace_api_tokens).
CREATE POLICY "oauth_refresh_tokens_owner_all" ON oauth_refresh_tokens
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- FUNCTION: Atomically consume (rotate) a refresh token.
-- Validates active + unexpired, stamps revoked_at + last_used_at, and
-- returns the identity context plus the consumed row's id (so the caller
-- can record rotated_from on the replacement). A replayed token finds
-- nothing (already revoked) and yields zero rows -> invalid_grant.
-- ============================================================
CREATE OR REPLACE FUNCTION consume_refresh_token(p_token_hash text)
RETURNS TABLE (
  id           uuid,
  client_id    text,
  user_id      uuid,
  agent_id     uuid,
  workspace_id uuid,
  scope        text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE oauth_refresh_tokens
  SET    revoked_at   = now(),
         last_used_at = now()
  WHERE  oauth_refresh_tokens.token_hash = p_token_hash
    AND  oauth_refresh_tokens.revoked_at IS NULL
    AND  oauth_refresh_tokens.expires_at > now()
  RETURNING
    oauth_refresh_tokens.id,
    oauth_refresh_tokens.client_id,
    oauth_refresh_tokens.user_id,
    oauth_refresh_tokens.agent_id,
    oauth_refresh_tokens.workspace_id,
    oauth_refresh_tokens.scope;
END;
$$;
