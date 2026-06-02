-- HOR-379 (Phase 5 of the Access Control epic, HOR-373) — property reassignment.
--
-- Hard requirement: reassignment must be cheaper than borrowing a login, or staff
-- share credentials and destroy the audit trail. So this moves a property AND
-- everything that hangs off it to a new agent, atomically, in one transaction:
--
--   1. properties.listing_agent_id        → new agent (the property itself)
--   2. events.attributed_agent_id         → new agent (its signals/events)
--   3. contacts.owner_agent_id + agent_id  → new agent (its resident contacts)
--        + one ownership_history row per moved contact (the durable contact trail
--          the rest of the app already reads — kept separate from audit_log).
--   4. in-flight comms (email_sends with status='scheduled') for those contacts:
--        re-attributed to the new agent and PAUSED (status→'draft', scheduled_at
--        cleared) so they are neither silently sent under the new identity nor
--        cancelled — the new agent reviews/re-sends. The scheduled worker only
--        ever selects status='scheduled', so a 'draft' is inert by construction.
--   5. one audit_log row (action 'property.reassign'), written IN-TXN so "the
--        move happened" and "the move was logged" can never diverge.
--
-- New-agent powers fall out of the Phase 1 capability layer for free: once
-- listing_agent_id = new agent, canActOnAgentScope(newAgent) is true for them and
-- false for the old agent — no extra grant, no extra revoke.
--
-- The capability gate (assign_properties = Admin|Manager, account-wide oversight)
-- is enforced in the calling route. This DEFINER fn is service_role-only and
-- trusts the actor identity its caller passes — the route is the trust boundary.

-- ── 1. Allow a paused/draft state on email_sends ────────────────────────────
ALTER TABLE public.email_sends DROP CONSTRAINT IF EXISTS email_sends_status_check;
ALTER TABLE public.email_sends ADD CONSTRAINT email_sends_status_check
  CHECK (status = ANY (ARRAY[
    'draft', 'queued', 'scheduled', 'sent',
    'soft_bounced', 'hard_bounced', 'failed', 'spam_complaint'
  ]));

-- ── 2. The transactional reassignment RPC ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.reassign_property(
  p_property_id    uuid,
  p_to_agent_id    uuid,
  p_actor_user_id  uuid,
  p_actor_agent_id uuid,
  p_reason         text DEFAULT 'manual_reassignment',
  p_notes          text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws             uuid;
  v_from_agent     uuid;
  v_to_status      text;
  v_to_ws          uuid;
  v_contact_ids    uuid[];
  v_contacts_moved int := 0;
  v_events_moved   int := 0;
  v_comms_paused   int := 0;
  v_comm_ids       uuid[];
BEGIN
  -- ── Guards ────────────────────────────────────────────────────────────────
  SELECT workspace_id, listing_agent_id INTO v_ws, v_from_agent
    FROM properties
   WHERE id = p_property_id AND deleted_at IS NULL;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'property_not_found';
  END IF;

  SELECT status, workspace_id INTO v_to_status, v_to_ws
    FROM agents WHERE id = p_to_agent_id;
  -- Target must exist, be active, and live in the SAME workspace as the property.
  IF v_to_status IS NULL OR v_to_ws IS DISTINCT FROM v_ws OR v_to_status <> 'active' THEN
    RAISE EXCEPTION 'invalid_target_agent';
  END IF;

  -- No-op guard: reassigning to the current listing agent changes nothing.
  IF v_from_agent IS NOT DISTINCT FROM p_to_agent_id THEN
    RAISE EXCEPTION 'same_agent';
  END IF;

  -- Defensive: coerce an unknown reason to the canonical manual value rather than
  -- trip the ownership_history reason CHECK and abort the whole transaction.
  IF p_reason IS NULL OR p_reason NOT IN
     ('initial_assignment', 'agent_departed', 'manual_reassignment', 'leave_cover', 'bulk_transfer') THEN
    p_reason := 'manual_reassignment';
  END IF;

  -- ── 1. The property itself ────────────────────────────────────────────────
  UPDATE properties
     SET listing_agent_id = p_to_agent_id, updated_at = now()
   WHERE id = p_property_id;

  -- ── 2. Its signals / events ───────────────────────────────────────────────
  WITH moved AS (
    UPDATE events
       SET attributed_agent_id = p_to_agent_id
     WHERE property_id = p_property_id
       AND workspace_id = v_ws
       AND attributed_agent_id IS DISTINCT FROM p_to_agent_id
    RETURNING 1
  )
  SELECT count(*) INTO v_events_moved FROM moved;

  -- ── 3. Its resident contacts + durable ownership_history trail ────────────
  SELECT array_agg(id) INTO v_contact_ids
    FROM contacts
   WHERE residence_property_id = p_property_id
     AND workspace_id = v_ws
     AND deleted_at IS NULL;

  IF v_contact_ids IS NOT NULL THEN
    -- History only for contacts whose ownership genuinely changes.
    INSERT INTO ownership_history
      (workspace_id, contact_id, from_agent_id, to_agent_id, transferred_by_agent_id, reason, notes)
    SELECT v_ws, c.id, COALESCE(c.owner_agent_id, c.agent_id), p_to_agent_id, p_actor_agent_id, p_reason, p_notes
      FROM contacts c
     WHERE c.id = ANY(v_contact_ids)
       AND COALESCE(c.owner_agent_id, c.agent_id) IS DISTINCT FROM p_to_agent_id;

    WITH moved AS (
      UPDATE contacts
         SET owner_agent_id = p_to_agent_id, agent_id = p_to_agent_id, updated_at = now()
       WHERE id = ANY(v_contact_ids)
         AND COALESCE(owner_agent_id, agent_id) IS DISTINCT FROM p_to_agent_id
      RETURNING 1
    )
    SELECT count(*) INTO v_contacts_moved FROM moved;
  END IF;

  -- ── 4. In-flight comms → paused drafts under the new agent ────────────────
  IF v_contact_ids IS NOT NULL THEN
    WITH paused AS (
      UPDATE email_sends
         SET status = 'draft',
             agent_id = p_to_agent_id,
             acting_user_id = p_actor_user_id,
             scheduled_at = NULL,
             updated_at = now()
       WHERE contact_id = ANY(v_contact_ids)
         AND workspace_id = v_ws
         AND status = 'scheduled'
      RETURNING id
    )
    SELECT count(*), array_agg(id) INTO v_comms_paused, v_comm_ids FROM paused;
  END IF;

  -- ── 5. Audit (in-txn, atomic with the move) ───────────────────────────────
  INSERT INTO audit_log
    (workspace_id, actor_user_id, actor_agent_id, acting_as_agent_id,
     action, resource_type, resource_id, scope, metadata)
  VALUES (
    v_ws, p_actor_user_id, p_actor_agent_id, NULL,
    'property.reassign', 'property', p_property_id, 'account',
    jsonb_build_object(
      'from_agent_id',   v_from_agent,
      'to_agent_id',     p_to_agent_id,
      'reason',          p_reason,
      'contacts_moved',  v_contacts_moved,
      'events_moved',    v_events_moved,
      'comms_paused',    v_comms_paused,
      'comm_ids',        COALESCE(to_jsonb(v_comm_ids), '[]'::jsonb)
    )
  );

  RETURN jsonb_build_object(
    'ok',             true,
    'from_agent_id',  v_from_agent,
    'to_agent_id',    p_to_agent_id,
    'contacts_moved', v_contacts_moved,
    'events_moved',   v_events_moved,
    'comms_paused',   v_comms_paused
  );
END
$$;

-- Service-role-only: the route validates the actor + capability, then invokes via
-- the service client. No anon/authenticated execute (DEFINER lockdown discipline).
REVOKE ALL ON FUNCTION
  public.reassign_property(uuid, uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.reassign_property(uuid, uuid, uuid, uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.reassign_property(uuid, uuid, uuid, uuid, text, text) TO service_role;
