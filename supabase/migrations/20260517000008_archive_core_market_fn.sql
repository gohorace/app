-- ============================================================
-- HOR-192  Core Markets — archive RPC (6 of 7)
--
-- archive_core_market(p_core_market_id, p_agent_id) handles the
-- "remove a market" path from Settings (HOR-196).
--
-- Brief: "Removing a core market — Properties in removed suburb →
-- archived (not deleted). Contact-to-property links retained.
-- Archived properties excluded from default views. Removing the
-- last core market re-triggers the Properties screen reminder."
--
-- Soft-delete semantics:
--   • Set archived_at on the core_markets row.
--   • Soft-delete (deleted_at = now()) properties in this workspace
--     whose gnaf_address_detail_pid → gnaf.address_principal points
--     at the locality — BUT only those with **no** linked contacts.
--     A property the agent's contact lives at stays visible because
--     "contact-to-property links retained".
--
-- "Linked" means EITHER:
--   • A live contact (deleted_at IS NULL) has residence_property_id
--     pointing here, OR
--   • Any row in contact_property_relationships references the
--     property (owners, buyers, appraised, etc.)
--
-- Returns the count of properties archived so the API can surface
-- "Archived. {n} unlinked properties hidden" in the toast.
--
-- SECURITY DEFINER + EXECUTE granted to service_role only — the
-- admin client (DELETE /api/core-markets/[id]) is the sole caller.
-- The route already validates the user owns p_agent_id via the
-- user → agent lookup; this function defends in depth by re-checking
-- the core_market belongs to the agent in its WHERE clause.
-- ============================================================

CREATE OR REPLACE FUNCTION public.archive_core_market(
  p_core_market_id uuid,
  p_agent_id       uuid
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_workspace_id uuid;
  v_locality_pid text;
  v_count        int;
BEGIN
  -- 1. Validate ownership + state.
  SELECT cm.workspace_id, cm.locality_pid
    INTO v_workspace_id, v_locality_pid
    FROM core_markets cm
   WHERE cm.id = p_core_market_id
     AND cm.agent_id = p_agent_id
     AND cm.archived_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'core_market % not found, not owned by agent %, or already archived',
      p_core_market_id, p_agent_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- 2. Soft-delete unlinked properties from this locality.
  --
  -- The CTE finds the targets; the UPDATE applies. We use
  -- GET DIAGNOSTICS for the count because the CTE is non-final.
  WITH unlinked AS (
    SELECT p.id
      FROM properties p
      JOIN gnaf.address_principal ap
        ON ap.address_detail_pid = p.gnaf_address_detail_pid
     WHERE p.workspace_id = v_workspace_id
       AND ap.locality_pid = v_locality_pid
       AND p.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM contacts c
          WHERE c.residence_property_id = p.id
            AND c.deleted_at IS NULL
       )
       AND NOT EXISTS (
         SELECT 1 FROM contact_property_relationships r
          WHERE r.property_id = p.id
       )
  )
  UPDATE properties
     SET deleted_at = now()
   WHERE id IN (SELECT id FROM unlinked);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- 3. Archive the core_markets row itself.
  UPDATE core_markets
     SET archived_at = now()
   WHERE id = p_core_market_id;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_core_market(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_core_market(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.archive_core_market(uuid, uuid) IS
  'HOR-192: Remove a core market. Soft-deletes the core_markets row + soft-deletes properties from the locality that have no linked contacts. Linked properties stay visible (brief: "contact-to-property links retained"). Returns count of properties archived. Service-role-only; admin client calls via DELETE /api/core-markets/[id].';
