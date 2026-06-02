-- ============================================================
-- HOR-377  Last-admin invariant  (Phase 3 of the Access Control epic, HOR-373)
--
-- The handoff spec (Multiple Admins, fixes single-point-of-failure):
--   "An Admin cannot remove the last remaining Admin (account must always
--    have ≥1)."
--
-- Enforced at the DB layer so EVERY path is covered — the promote/demote API,
-- the member-removal route (flips agents.status='departed'), a stray manual SQL
-- edit, all of it. A workspace with ≥1 admin can never drop to zero via:
--   • demotion         (UPDATE agents SET role <> 'admin' on the last admin)
--   • departure/suspend (UPDATE agents SET status <> 'active' on the last admin)
--   • deletion          (DELETE the last admin's agents row)
--
-- "Admin" = canonical Role axis: agents.role='admin' AND status='active'
-- (HOR-376). A row that is already non-admin or non-active isn't a protected
-- admin, so transitions that don't reduce the active-admin set are unaffected.
--
-- ⚠️ Migration drift: apply via Studio SQL editor + manual INSERT into
-- supabase_migrations.schema_migrations. Do NOT `supabase db push` (HOR-131).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  was_active_admin boolean;
  still_active_admin boolean;
  remaining integer;
  ws uuid;
BEGIN
  -- Was the OLD row a protected (active) admin?
  was_active_admin := (OLD.role = 'admin' AND OLD.status = 'active');
  IF NOT was_active_admin THEN
    RETURN COALESCE(NEW, OLD);  -- not an admin we protect; nothing to check
  END IF;

  ws := OLD.workspace_id;
  IF ws IS NULL THEN
    RETURN COALESCE(NEW, OLD);  -- workspace-less rows aren't part of any account
  END IF;

  IF (TG_OP = 'UPDATE') THEN
    still_active_admin := (NEW.role = 'admin' AND NEW.status = 'active'
                           AND NEW.workspace_id = ws);
    IF still_active_admin THEN
      RETURN NEW;  -- remains an active admin in the same workspace; fine
    END IF;
  END IF;

  -- The row is leaving the active-admin set (demote / depart / suspend / delete).
  -- Count OTHER active admins in the workspace.
  SELECT count(*) INTO remaining
  FROM agents
  WHERE workspace_id = ws
    AND role = 'admin'
    AND status = 'active'
    AND id <> OLD.id;

  IF remaining = 0 THEN
    RAISE EXCEPTION 'workspace must retain at least one active admin'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS agents_last_admin_guard ON agents;
CREATE TRIGGER agents_last_admin_guard
  BEFORE UPDATE OR DELETE ON agents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_last_admin();

COMMENT ON FUNCTION public.enforce_last_admin() IS
  'HOR-377: prevents a workspace from losing its last active Admin (agents.role=''admin'' AND status=''active'') via demotion, departure, suspension, or deletion. Raises check_violation (23514) when the last admin would be removed.';

COMMIT;
