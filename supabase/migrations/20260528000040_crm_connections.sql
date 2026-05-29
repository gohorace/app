-- HOR-324 · CRM connections (concierge-first)
--
-- One row per (agency, CRM). `status` drives the whole Connections UI. V1 is
-- concierge-first: the UI is real, fulfilment is manual — a request flips the
-- row to 'assisted_pending' and (Phase 5, HOR-325) posts to #connection-requests;
-- the Horace team wires it up by hand and flips it to 'active'. The one real
-- self-serve adapter (Phase 6/7) reuses the same row via auth_method='api_key'
-- + credential_ref (a Vault pointer — never the raw secret).
--
-- No new SECURITY DEFINER functions here (just a table + RLS + updated_at
-- trigger), so nothing to lock down.
--
-- ⚠️ Migration drift: apply via Studio SQL editor + manual INSERT of
-- '20260528000040', NOT `supabase db push`, until HOR-131.

BEGIN;

CREATE TABLE IF NOT EXISTS crm_connections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  system           text NOT NULL,            -- 'rex' | 'vaultre' | 'agentbox' | 'hubspot' | 'other' | …
  display_name     text NOT NULL,
  status           text NOT NULL DEFAULT 'not_connected'
    CHECK (status IN ('not_connected', 'connecting', 'active', 'error', 'assisted_pending')),
  auth_method      text CHECK (auth_method IN ('api_key', 'oauth')),  -- api_key only in V1
  credential_ref   uuid,                     -- pointer to vault.secrets; never the raw secret
  inbound_enabled  boolean NOT NULL DEFAULT false,   -- pull contacts in
  outbound_enabled boolean NOT NULL DEFAULT false,   -- push Doorstep leads out
  last_synced_at   timestamptz,
  last_error       text,                     -- human-readable, Horace's voice
  connected_by     uuid REFERENCES agents(id) ON DELETE SET NULL,
  connected_at     timestamptz,
  requested_at     timestamptz,              -- when the concierge request was submitted
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- One connection per CRM per agency.
  UNIQUE (workspace_id, system)
);

CREATE INDEX IF NOT EXISTS crm_connections_workspace_idx
  ON crm_connections (workspace_id);

ALTER TABLE crm_connections ENABLE ROW LEVEL SECURITY;

-- Any workspace member can see connection status; writes go through the
-- admin-gated service-role routes.
DROP POLICY IF EXISTS "crm_connections_select" ON crm_connections;
CREATE POLICY "crm_connections_select" ON crm_connections
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

DROP TRIGGER IF EXISTS crm_connections_updated_at ON crm_connections;
CREATE TRIGGER crm_connections_updated_at
  BEFORE UPDATE ON crm_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE crm_connections IS
  'HOR-324: one row per (agency, CRM). status drives the Connections UI. Concierge-first — a request sets assisted_pending; the team flips to active. credential_ref points to Vault, never the raw secret.';

COMMIT;
