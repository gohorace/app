-- ============================================================
-- Agent inbound addresses (HOR-63)
--
-- Maps an opaque local_part (e.g. 'a7k2x9m4q1') to an agent.
-- The full receiving address is `<local_part>@portal.gohorace.com`.
-- Agents add their address to portal listings (REA, Domain) so
-- enquiries route directly to them — no listing-agent name fuzzy
-- matching at parse time.
--
-- Per-agent (not per-workspace) so multi-agent agencies can route
-- correctly without ambiguity. Workspace is derived from the
-- agent's existing workspace_id.
-- ============================================================

CREATE TABLE agent_inbound_addresses (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    uuid        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  local_part  text        NOT NULL UNIQUE,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_inbound_addresses_agent_id_idx
  ON agent_inbound_addresses(agent_id);

-- Lookup index for the hot path: webhook → resolve agent_id by local_part.
-- Filtered on is_active so rotated addresses don't pollute the lookup.
CREATE INDEX agent_inbound_addresses_active_local_part_idx
  ON agent_inbound_addresses(local_part)
  WHERE is_active;

ALTER TABLE agent_inbound_addresses ENABLE ROW LEVEL SECURITY;

-- Workspace members can read addresses for any agent in workspaces they belong to.
-- Writes are service-role only (no INSERT/UPDATE/DELETE policies).
CREATE POLICY "agent_inbound_addresses_select" ON agent_inbound_addresses
  FOR SELECT USING (
    agent_id IN (
      SELECT id FROM agents WHERE workspace_id = ANY(public.user_workspace_ids())
    )
  );

COMMENT ON TABLE agent_inbound_addresses IS
  'Opaque per-agent inbound email addresses for portal capture (HOR-63).';
