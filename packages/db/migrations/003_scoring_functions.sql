-- ============================================================
-- Migration 003: Scoring Functions and Triggers
-- ============================================================

-- ============================================================
-- TRIGGER: Back-fill events with contact_id when session is
-- linked to a contact (identity resolution)
-- ============================================================

CREATE OR REPLACE FUNCTION backfill_events_contact_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- When session.contact_id transitions from NULL to a value,
  -- update all existing events for this session that lack a contact_id
  IF NEW.contact_id IS NOT NULL AND OLD.contact_id IS NULL THEN
    UPDATE events
    SET contact_id = NEW.contact_id
    WHERE session_id = NEW.id
      AND contact_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER session_contact_backfill
  AFTER UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION backfill_events_contact_id();

-- ============================================================
-- TRIGGER: Update contacts.last_seen_at when new events arrive
-- ============================================================

CREATE OR REPLACE FUNCTION update_contact_last_seen()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL THEN
    UPDATE contacts
    SET last_seen_at = GREATEST(last_seen_at, NEW.occurred_at)
    WHERE id = NEW.contact_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_update_contact_last_seen
  AFTER INSERT ON events
  FOR EACH ROW
  EXECUTE FUNCTION update_contact_last_seen();

-- ============================================================
-- TRIGGER: Update org_settings.updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER org_settings_updated_at
  BEFORE UPDATE ON org_settings
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- FUNCTION: Create org with settings and member in one call
-- (used by signup flow via service role)
-- ============================================================

CREATE OR REPLACE FUNCTION create_org_with_owner(
  p_user_id  uuid,
  p_name     text,
  p_slug     text,
  p_email    text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  INSERT INTO orgs (name, slug)
  VALUES (p_name, p_slug)
  RETURNING id INTO v_org_id;

  INSERT INTO org_members (org_id, user_id, role)
  VALUES (v_org_id, p_user_id, 'owner');

  INSERT INTO org_settings (org_id, agent_email)
  VALUES (v_org_id, p_email);

  RETURN v_org_id;
END;
$$;

-- ============================================================
-- FUNCTION: Get weekly briefing data for an org
-- ============================================================

CREATE OR REPLACE FUNCTION get_weekly_briefing_data(p_org_id uuid)
RETURNS TABLE (
  contact_id    uuid,
  first_name    text,
  last_name     text,
  email         text,
  score         int,
  score_change  bigint,
  event_count   bigint,
  last_seen_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id AS contact_id,
    c.first_name,
    c.last_name,
    c.email,
    c.score,
    COALESCE(SUM(sh.delta), 0) AS score_change,
    COUNT(DISTINCT e.id) AS event_count,
    c.last_seen_at
  FROM contacts c
  JOIN events e
    ON e.contact_id = c.id
    AND e.occurred_at > now() - INTERVAL '7 days'
  LEFT JOIN score_history sh
    ON sh.contact_id = c.id
    AND sh.occurred_at > now() - INTERVAL '7 days'
  WHERE c.org_id = p_org_id
  GROUP BY c.id
  ORDER BY score_change DESC
  LIMIT 10;
$$;
