-- HOR-380 (Phase 6 of the Access Control epic, HOR-373) — co-listing.
--
-- Many-to-many property <-> agent, so more than one agent can hold a property and
-- all of them see its signals + can act on its contacts. This is the PERMISSION /
-- DATA layer only. Per the spec it must NOT launch a user-facing co-listing flow
-- until the Product double-contact nudge ("Sam already reached out Tuesday")
-- exists — so the whole layer is built to be INERT until a non-primary (co-agent)
-- row is created, and no add-co-agent UI ships here.
--
-- Visibility reality this is built on (see prod RLS today):
--   • properties / events are already WORKSPACE-wide visible (workspace_id RLS) —
--     "the property is shared". Co-listing barely changes property/signal reads.
--   • contacts are the one AGENT-scoped surface (contacts_all: agent_id ANY
--     user_agent_ids()). So co-listing's real effect = sharing a property's
--     contacts + the ability to act among its agents.
--
-- listing_agent_id stays as the denormalised PRIMARY pointer (single source of
-- truth for "who's primary"); property_agents mirrors it as is_primary=true and
-- carries the additional co-agents.

-- ── 1. The join table ───────────────────────────────────────────────────────
CREATE TABLE public.property_agents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  property_id       uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  agent_id          uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role              text NOT NULL DEFAULT 'co' CHECK (role IN ('primary', 'co')),
  is_primary        boolean NOT NULL DEFAULT false,
  added_by_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, agent_id)
);

CREATE INDEX property_agents_agent_idx ON public.property_agents (agent_id);
CREATE INDEX property_agents_property_idx ON public.property_agents (property_id);
-- At most one primary per property (the denormalised listing_agent_id).
CREATE UNIQUE INDEX property_agents_one_primary_idx
  ON public.property_agents (property_id) WHERE is_primary;

-- ── 2. Backfill the primary rows from the existing denormalised pointer ──────
INSERT INTO public.property_agents
  (workspace_id, property_id, agent_id, role, is_primary, added_by_agent_id)
SELECT p.workspace_id, p.id, p.listing_agent_id, 'primary', true, p.listing_agent_id
  FROM properties p
 WHERE p.listing_agent_id IS NOT NULL
   AND p.deleted_at IS NULL
ON CONFLICT (property_id, agent_id) DO NOTHING;

-- ── 3. Keep the primary row mirrored to listing_agent_id ────────────────────
-- Fires on insert and on any change of listing_agent_id (incl. the Phase 5
-- reassign_property RPC). Treats listing_agent_id as the single source of truth
-- for the PRIMARY slot: the prior primary row is removed (so a reassigned-away
-- agent loses membership — consistent with Phase 5 "old agent loses access"),
-- the new listing agent becomes primary (promoting them if they were a co-agent).
-- Non-primary co-agent rows are deliberately untouched.
CREATE OR REPLACE FUNCTION public.sync_property_primary_agent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM property_agents
   WHERE property_id = NEW.id
     AND is_primary
     AND agent_id IS DISTINCT FROM NEW.listing_agent_id;

  IF NEW.listing_agent_id IS NOT NULL THEN
    INSERT INTO property_agents
      (workspace_id, property_id, agent_id, role, is_primary, added_by_agent_id)
    VALUES
      (NEW.workspace_id, NEW.id, NEW.listing_agent_id, 'primary', true, NEW.listing_agent_id)
    ON CONFLICT (property_id, agent_id)
      DO UPDATE SET is_primary = true, role = 'primary';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.sync_property_primary_agent() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_sync_property_primary_agent
  AFTER INSERT OR UPDATE OF listing_agent_id ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.sync_property_primary_agent();

-- ── 4. RLS on the join table ────────────────────────────────────────────────
-- Read: any workspace member (mirrors properties — the property is shared).
-- Write: service_role only (the add-co-agent action will go through a service
-- route when it launches with the nudge; no authenticated write today).
ALTER TABLE public.property_agents ENABLE ROW LEVEL SECURITY;

-- No TO clause → applies to PUBLIC, matching the sibling properties_select /
-- workspaces_select policies (service_role bypasses RLS; anon has no agent ids).
CREATE POLICY property_agents_select ON public.property_agents
  FOR SELECT
  USING (workspace_id = ANY (user_workspace_ids()));

-- ── 5. Widen contact visibility for genuine co-agents (inert pre-launch) ─────
-- A co-agent (is_primary = false) sees + can act on the contacts that live at a
-- property they co-list. Keyed on is_primary = false so it grants NOTHING until a
-- real co-agent row exists — which can't happen until the gated add flow ships.
-- Recreated faithfully: same name, PERMISSIVE, roles {public} (no TO clause),
-- cmd ALL — only the predicate is widened (additive OR), so no existing access
-- is removed.
DROP POLICY IF EXISTS contacts_all ON public.contacts;
CREATE POLICY contacts_all ON public.contacts
  FOR ALL
  USING (
    agent_id = ANY (user_agent_ids())
    OR residence_property_id IN (
      SELECT pa.property_id FROM property_agents pa
       WHERE pa.agent_id = ANY (user_agent_ids())
         AND pa.is_primary = false
    )
  )
  WITH CHECK (
    agent_id = ANY (user_agent_ids())
    OR residence_property_id IN (
      SELECT pa.property_id FROM property_agents pa
       WHERE pa.agent_id = ANY (user_agent_ids())
         AND pa.is_primary = false
    )
  );
