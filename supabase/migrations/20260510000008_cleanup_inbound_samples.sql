-- ============================================================
-- HOR-63 cleanup: drop spike artefacts + add monitor view
--
-- inbound_email_samples was the spike capture table from HOR-28;
-- the production pipeline (Phase 1b) uses inbound_emails. Drop
-- the spike table now that the production schema is live.
--
-- Add inbound_emails_unresolved view as the operational monitor —
-- shows every captured email that didn't end up cleanly parsed,
-- so you can spot no_match / parse_failed / pending_body rows
-- without writing the same query repeatedly.
-- ============================================================

DROP TABLE IF EXISTS inbound_email_samples;

CREATE OR REPLACE VIEW inbound_emails_unresolved AS
SELECT
  ie.id,
  ie.received_at,
  ie.source_portal,
  ie.parse_status,
  ie.parse_error,
  ie.message_id,
  ie.agent_id,
  ie.webhook_payload -> 'data' ->> 'subject'  AS subject,
  ie.webhook_payload -> 'data' -> 'to'        AS to_addresses,
  ie.webhook_payload -> 'data' ->> 'from'     AS from_address
FROM inbound_emails ie
WHERE ie.parse_status <> 'parsed'
ORDER BY ie.received_at DESC;

COMMENT ON VIEW inbound_emails_unresolved IS
  'Operational monitor: inbound emails not cleanly parsed. Filter by received_at for time windows.';
