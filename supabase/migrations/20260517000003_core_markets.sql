-- ============================================================
-- HOR-192  Core Markets — per-agent suburb selections (1 of 7)
--
-- core_markets: an agent picks 1–3 suburbs they work. On insert,
-- /api/core-markets (HOR-193) enqueues a core_market_imports row;
-- the Edge Function worker (also HOR-193) drains the G-NAF locality
-- into the workspace's properties table.
--
-- Per-agent, NOT per-workspace — the brief explicitly: "Core markets
-- are per-agent, not per-brokerage/workspace." Two agents in the same
-- workspace whose markets overlap end up sharing the underlying
-- properties rows (workspace-scoped), but their core_markets selections
-- are independent.
--
-- Soft-delete via archived_at; the partial unique index allows re-add
-- of the same suburb after archive (creates a new row, doesn't
-- resurrect the old). Removal triggers archive_core_market RPC (A8)
-- which soft-deletes unlinked properties in the locality.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS core_markets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id      uuid NOT NULL REFERENCES agents(id)     ON DELETE CASCADE,
  locality_pid  text NOT NULL REFERENCES gnaf.localities(locality_pid),
  -- Denormalised so the Properties / Settings UIs can render without
  -- joining gnaf. Set at INSERT time from gnaf.localities; refreshed
  -- only if we ever surface a "locality renamed" admin tool.
  locality_name text NOT NULL,
  state_abbrev  text NOT NULL,
  postcode      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz
);

-- One active row per (agent, locality). Re-adding after archive
-- creates a new row — we don't resurrect the prior one.
CREATE UNIQUE INDEX IF NOT EXISTS core_markets_agent_locality_uidx
  ON core_markets (agent_id, locality_pid)
  WHERE archived_at IS NULL;

-- Workspace-wide read path (Settings page lists current markets;
-- Properties page joins for the empty-state check).
CREATE INDEX IF NOT EXISTS core_markets_workspace_idx
  ON core_markets (workspace_id);

-- Hot path: "list this agent's active markets" — the 1–3 cap means
-- the planner can rely on the partial index to skip archived rows
-- entirely.
CREATE INDEX IF NOT EXISTS core_markets_agent_active_idx
  ON core_markets (agent_id) WHERE archived_at IS NULL;

ALTER TABLE core_markets ENABLE ROW LEVEL SECURITY;

-- Workspace members can read all core_markets in their workspace
-- (Settings UI for "my markets" filters by agent_id in the query;
-- Properties UI joins for the empty-state and suburb-dropdown source
-- and needs to see the wider workspace set).
DROP POLICY IF EXISTS "core_markets_select" ON core_markets;
CREATE POLICY "core_markets_select" ON core_markets
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

-- No INSERT/UPDATE/DELETE policies. /api/core-markets uses the admin
-- client (service-role) and explicitly enforces agent_id ownership in
-- WHERE. Locking down the policy surface here prevents accidental
-- writes through the anon/authenticated keys if those ever start
-- carrying real users.

COMMENT ON TABLE core_markets IS
  'HOR-189: Per-agent core market selections. An agent picks 1–3 suburbs (gnaf.localities) they work; the import path (HOR-193) bulk-loads every G-NAF address in the locality into the workspace''s properties table and auto-matches against existing contacts.';
COMMENT ON COLUMN core_markets.agent_id IS
  'Owning agent. Brief: core markets are per-agent, not per-workspace. Two agents sharing a workspace whose markets overlap end up sharing the underlying properties rows (workspace-scoped) but independent core_markets selections.';
COMMENT ON COLUMN core_markets.archived_at IS
  'Soft-delete timestamp. archive_core_market RPC (HOR-192) sets this and soft-deletes unlinked properties in the locality. The partial unique index ignores archived rows so the agent can re-add the same suburb later (creates a new row).';

COMMIT;
