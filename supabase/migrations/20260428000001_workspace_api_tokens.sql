-- ============================================================
-- Migration 009: Workspace API tokens
-- Bearer tokens that authenticate MCP requests as a specific
-- (workspace, agent) pair. The plaintext token is shown once at
-- mint time; only its SHA-256 hash is stored.
-- ============================================================

CREATE TABLE workspace_api_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id     uuid NOT NULL REFERENCES agents(id)     ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workspace_api_tokens_workspace_idx ON workspace_api_tokens(workspace_id);
CREATE INDEX workspace_api_tokens_agent_idx     ON workspace_api_tokens(agent_id);
CREATE INDEX workspace_api_tokens_active_idx
  ON workspace_api_tokens(token_hash)
  WHERE revoked_at IS NULL;

ALTER TABLE workspace_api_tokens ENABLE ROW LEVEL SECURITY;

-- Users can list/manage tokens they personally minted. Lookup by hash
-- happens server-side via service role and bypasses RLS.
CREATE POLICY "workspace_api_tokens_owner_all" ON workspace_api_tokens
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- FUNCTION: Look up an active token by its SHA-256 hash and
-- atomically stamp last_used_at. Returns the token's identity
-- context (workspace_id, agent_id) or NULL if not found / revoked.
-- Called by the MCP route via service role.
-- ============================================================

CREATE OR REPLACE FUNCTION resolve_api_token(p_token_hash text)
RETURNS TABLE (workspace_id uuid, agent_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE workspace_api_tokens
  SET    last_used_at = now()
  WHERE  token_hash = p_token_hash
    AND  revoked_at IS NULL
  RETURNING workspace_api_tokens.workspace_id, workspace_api_tokens.agent_id;
END;
$$;
