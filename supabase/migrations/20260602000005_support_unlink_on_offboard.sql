-- ============================================================
-- HOR-378  Support link lifecycle on offboard  (Phase 4, HOR-373)
--
-- Spec open question, resolved (Andy 2026-06-02): when an agent is offboarded
-- (agents.status → 'departed'), auto-unlink any Support delegation touching them.
-- We do NOT auto-re-link a Support seat to whoever inherits the departed agent's
-- properties — that requires an explicit re-grant.
--
-- Covers both directions:
--   • the departed row IS a support seat   → drop the seats it covers
--   • the departed row is a linked agent    → drop every support link to it
--
-- This keeps user_agent_ids()/getActor from granting a Support seat visibility
-- into a departed agent's scope, and stops a departed support seat retaining
-- access. Idempotent; fires only on the active→departed transition.
--
-- ⚠️ Migration drift: apply via Studio SQL editor + manual INSERT into
-- supabase_migrations.schema_migrations. Do NOT `supabase db push` (HOR-131).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.unlink_support_on_offboard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'departed' AND OLD.status <> 'departed' THEN
    DELETE FROM support_seat_assignments
    WHERE support_agent_id = NEW.id
       OR assigned_agent_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agents_unlink_support_on_offboard ON agents;
CREATE TRIGGER agents_unlink_support_on_offboard
  AFTER UPDATE OF status ON agents
  FOR EACH ROW EXECUTE FUNCTION public.unlink_support_on_offboard();

COMMENT ON FUNCTION public.unlink_support_on_offboard() IS
  'HOR-378: on an agent''s active→departed transition, removes all support_seat_assignments where it is either the support seat or the linked agent. No auto-re-link (explicit re-grant required).';

COMMIT;
