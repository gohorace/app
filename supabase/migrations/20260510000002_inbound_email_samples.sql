-- ============================================================
-- Inbound email samples (HOR-28 spike)
--
-- Captures raw MIME + Resend's parsed payload for every inbound
-- email hitting portal.horace.app. Used to validate Resend's
-- inbound parser against real REA / Domain enquiry formats before
-- writing the inbound-email-infrastructure ADR.
--
-- Spike-only: drop or repurpose once the ADR is decided.
-- RLS enabled with no policies — service role only.
-- ============================================================

CREATE TABLE inbound_email_samples (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at   timestamptz NOT NULL DEFAULT now(),
  to_address    text,
  from_address  text,
  subject       text,
  message_id    text UNIQUE,
  source_portal text,
  parsed        jsonb,
  raw_mime      text
);

CREATE INDEX inbound_email_samples_received_at_idx
  ON inbound_email_samples(received_at DESC);

ALTER TABLE inbound_email_samples ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only. Anon / authenticated cannot read or write.

COMMENT ON TABLE inbound_email_samples IS
  'HOR-28 spike: raw + parsed inbound email captures from Resend. Drop after ADR.';
