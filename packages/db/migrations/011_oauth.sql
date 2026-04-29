-- ============================================================
-- Migration 011: OAuth 2.1 + PKCE + Dynamic Client Registration
-- Lets Claude.ai (and any other OAuth-aware client) connect to
-- the MCP via the standard authorization-code flow.
--
-- Existing personal-access tokens (client_id NULL) keep working;
-- OAuth-issued tokens reuse the same workspace_api_tokens row,
-- with a non-null client_id, expires_at, and scope.
-- ============================================================

-- ============================================================
-- OAUTH CLIENTS
-- One row per registered client. Most are created via dynamic
-- registration when Claude.ai connects for the first time.
-- ============================================================

CREATE TABLE oauth_clients (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          text NOT NULL UNIQUE,
  client_secret_hash text,                                 -- NULL for public/PKCE clients
  client_name        text,
  redirect_uris      text[] NOT NULL,
  scope              text NOT NULL DEFAULT 'mcp',
  metadata           jsonb NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_clients_client_id_idx ON oauth_clients(client_id);

-- Service-role only; no user-facing access.
ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- OAUTH AUTHORIZATION CODES
-- Short-lived (≤10 min) single-use codes issued by /oauth/authorize
-- and consumed by /oauth/token.
-- ============================================================

CREATE TABLE oauth_authorization_codes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL UNIQUE,
  client_id             text NOT NULL,
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id              uuid NOT NULL REFERENCES agents(id)     ON DELETE CASCADE,
  workspace_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  redirect_uri          text NOT NULL,
  code_challenge        text NOT NULL,
  code_challenge_method text NOT NULL DEFAULT 'S256'
                          CHECK (code_challenge_method IN ('S256')),
  scope                 text NOT NULL,
  expires_at            timestamptz NOT NULL,
  used_at               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_codes_code_idx        ON oauth_authorization_codes(code);
CREATE INDEX oauth_codes_user_id_idx     ON oauth_authorization_codes(user_id);

ALTER TABLE oauth_authorization_codes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- EXTEND workspace_api_tokens FOR OAUTH-ISSUED TOKENS
-- Personal tokens leave these NULL; OAuth tokens populate them.
-- ============================================================

ALTER TABLE workspace_api_tokens
  ADD COLUMN client_id  text,
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN scope      text;

CREATE INDEX workspace_api_tokens_client_id_idx ON workspace_api_tokens(client_id);

-- ============================================================
-- Refresh resolve_api_token to honour expires_at.
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
    AND  (expires_at IS NULL OR expires_at > now())
  RETURNING workspace_api_tokens.workspace_id, workspace_api_tokens.agent_id;
END;
$$;

-- ============================================================
-- FUNCTION: Atomically consume an authorization code.
-- Marks used_at and returns the code's identity context, or
-- NULL if the code doesn't exist, is expired, or already used.
-- ============================================================

CREATE OR REPLACE FUNCTION consume_oauth_code(p_code text)
RETURNS TABLE (
  client_id             text,
  user_id               uuid,
  agent_id              uuid,
  workspace_id          uuid,
  redirect_uri          text,
  code_challenge        text,
  code_challenge_method text,
  scope                 text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE oauth_authorization_codes
  SET    used_at = now()
  WHERE  code = p_code
    AND  used_at IS NULL
    AND  expires_at > now()
  RETURNING
    oauth_authorization_codes.client_id,
    oauth_authorization_codes.user_id,
    oauth_authorization_codes.agent_id,
    oauth_authorization_codes.workspace_id,
    oauth_authorization_codes.redirect_uri,
    oauth_authorization_codes.code_challenge,
    oauth_authorization_codes.code_challenge_method,
    oauth_authorization_codes.scope;
END;
$$;
