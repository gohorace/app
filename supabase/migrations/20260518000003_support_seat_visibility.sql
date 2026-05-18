-- ============================================================
-- HOR-203  Support seat visibility — widen user_agent_ids()
--
-- The v1 `user_agent_ids()` returns only the agent IDs OWNED by the
-- caller (i.e. agents rows where user_id = auth.uid()). That powers
-- the RLS policies on contacts, score_history, agent_settings, etc.
--
-- A support seat is its own agents row with seat_type='support'. With
-- the v1 helper, RLS would scope a support seat's reads to their own
-- agent_id — which never owns any contacts — so they'd see nothing.
--
-- This migration widens `user_agent_ids()` to also return the
-- `assigned_agent_id`s from any `support_seat_assignments` rows that
-- target this caller's support seat. Net effect: a support seat sees
-- everything their assigned agent(s) see. RLS policies on contacts,
-- score_history, agent_settings, identity_map, sessions, events,
-- notification_log, etc. all benefit without further edits.
--
-- Writes still flow through agent_id = caller's-own-agent-id checks in
-- app code (contacts PATCH, etc.) — those need a separate widening
-- (see contacts PATCH gate in this PR for the pattern; full audit is
-- HOR-205 follow-up).
--
-- ⚠️ Migration drift caveat: same as 20260518000001 — apply via Studio
-- SQL editor + manual INSERT into supabase_migrations.schema_migrations.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.user_agent_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ARRAY(
    -- Own agent rows (the v1 behaviour).
    SELECT id FROM agents WHERE user_id = auth.uid()
    UNION
    -- Plus the agents this caller's support seat(s) are assigned to.
    -- A support seat sees their assigned agent's signals.
    SELECT ssa.assigned_agent_id
    FROM support_seat_assignments ssa
    JOIN agents a_support ON a_support.id = ssa.support_agent_id
    WHERE a_support.user_id = auth.uid()
      AND a_support.status <> 'departed'
  )
$$;

COMMENT ON FUNCTION public.user_agent_ids() IS
  'HOR-203: returns the array of agent IDs the current user can read through RLS — their own agents row IDs plus any agent IDs they have a support_seat_assignments row for. Used by RLS policies across contacts, score_history, agent_settings, etc.';

COMMIT;
