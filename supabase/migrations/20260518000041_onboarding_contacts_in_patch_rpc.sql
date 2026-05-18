-- ============================================================
-- HOR-211  Onboarding contacts-in-patch count
--
-- Used by Turn 4 of the agentic onboarding shell ("X of them already
-- live in your patch") right after the CSV import lands. Counts:
--   • total  — every non-deleted contact in the agent's workspace
--   • in_patch — subset whose suburb matches one of the agent's
--                ACTIVE core_markets localities (case-insensitive)
--
-- Why an RPC rather than a route-level query: case-insensitive
-- IN-list match. The supabase-js builder doesn't have a clean
-- `.in('lower(suburb)', names.map(lower))` form, and shipping the
-- comparison server-side keeps the join predicate in one place.
--
-- contacts.suburb is denormalised from residence_property_id by the
-- sync_contact_suburb trigger (20260513000005) so the join is
-- straightforward — no gnaf.address lookup needed at query time.
--
-- ⚠️ Migration drift: supabase_migrations.schema_migrations is
-- reconciled through 20260518000030. Apply via Studio + manual INSERT
-- of '20260518000041', not `supabase db push`, until HOR-131 clears
-- the legacy.
-- ============================================================

CREATE OR REPLACE FUNCTION onboarding_contacts_in_patch(p_agent_id uuid)
RETURNS TABLE(total bigint, in_patch bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ws AS (
    SELECT workspace_id FROM agents WHERE id = p_agent_id
  ),
  names AS (
    SELECT lower(locality_name) AS n
    FROM core_markets
    WHERE agent_id = p_agent_id
      AND archived_at IS NULL
  )
  SELECT
    (
      SELECT count(*)
      FROM contacts c, ws
      WHERE c.workspace_id = ws.workspace_id
        AND c.deleted_at IS NULL
    ) AS total,
    (
      SELECT count(*)
      FROM contacts c, ws
      WHERE c.workspace_id = ws.workspace_id
        AND c.deleted_at IS NULL
        AND c.suburb IS NOT NULL
        AND lower(c.suburb) IN (SELECT n FROM names)
    ) AS in_patch;
$$;

COMMENT ON FUNCTION onboarding_contacts_in_patch IS
  'Returns (total, in_patch) contact counts for an agent. in_patch is the
   subset whose suburb matches one of the agent''s active core_markets
   localities, case-insensitive. Surfaced by Turn 4 of the agentic
   onboarding shell. SECURITY DEFINER + p_agent_id arg means the route
   handler is responsible for checking the caller owns the agent_id.';
