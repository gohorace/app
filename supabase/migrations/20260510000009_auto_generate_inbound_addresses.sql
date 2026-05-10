-- ============================================================
-- Auto-generate agent_inbound_addresses (HOR-64 follow-up)
--
-- Originally HOR-63 expected addresses to be inserted manually
-- per agent. That doesn't scale — every new agent should get an
-- address automatically on signup, and every existing agent who
-- doesn't have one yet should be backfilled.
--
-- This migration adds:
--   1. generate_inbound_local_part() — crypto-random 10-char nanoid
--      (lowercase + digits, ambiguous chars 0/1/i/l/o removed)
--   2. AFTER INSERT trigger on agents that creates a row in
--      agent_inbound_addresses with a fresh local_part
--   3. Backfill INSERT for existing agents without an active address
-- ============================================================

CREATE OR REPLACE FUNCTION generate_inbound_local_part()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  -- 31 unambiguous chars (0/1/i/l/o stripped). 31^10 ≈ 8.2 × 10^14 → plenty of entropy.
  alphabet constant text := '23456789abcdefghjkmnpqrstuvwxyz';
  result text := '';
  bytes  bytea;
  i      int;
BEGIN
  bytes := gen_random_bytes(10);
  FOR i IN 1..10 LOOP
    result := result || substr(alphabet, 1 + (get_byte(bytes, i - 1) % length(alphabet)), 1);
  END LOOP;
  RETURN result;
END;
$$;

-- Trigger function: insert an active address for the new agent.
-- Retries on the (astronomically unlikely) collision of two random
-- local_parts; gives up after 5 attempts so a misconfiguration can't
-- spin forever.
CREATE OR REPLACE FUNCTION agents_create_inbound_address()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attempt int := 0;
BEGIN
  LOOP
    BEGIN
      INSERT INTO agent_inbound_addresses (agent_id, local_part)
      VALUES (NEW.id, generate_inbound_local_part());
      RETURN NEW;
    EXCEPTION WHEN unique_violation THEN
      attempt := attempt + 1;
      IF attempt > 5 THEN RAISE; END IF;
    END;
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS agents_create_inbound_address_trg ON agents;
CREATE TRIGGER agents_create_inbound_address_trg
  AFTER INSERT ON agents
  FOR EACH ROW
  EXECUTE FUNCTION agents_create_inbound_address();

-- Backfill existing agents that don't yet have an active address.
INSERT INTO agent_inbound_addresses (agent_id, local_part)
SELECT a.id, generate_inbound_local_part()
FROM agents a
LEFT JOIN agent_inbound_addresses aia
  ON aia.agent_id = a.id AND aia.is_active = true
WHERE aia.id IS NULL;
