-- ============================================================
-- HOR-56  Mobile push pairing
--
-- Lands the foundations for the "Take Horace with you" onboarding
-- step that pairs an agent's phone for web-push:
--
--   1. Adds 'pair' as a valid value on agents.last_completed_step
--      (between 'notify' and 'done'). Drops the existing CHECK
--      constraint from migration 20260510000001 and re-adds it
--      with the extended set.
--
--   2. Creates pairing_tokens — one-time, hashed signed tokens
--      that authorise a phone to redeem a Supabase magic-link
--      for the agent's account and complete the pairing flow.
--      Storage convention (token_hash via sha256) mirrors
--      workspace_invites — the raw token is never persisted.
--
--   3. Adds push_subscriptions.device_kind so we can label the
--      paired-state pill ("Push is live on your iPhone") and
--      future test-push filtering can target a specific kind.
--
-- The pairing flow itself (token API, /m/[token] redirect,
-- desktop QR/SMS surface, phone install + push prompt, dashboard
-- standalone overlay) lands in subsequent HOR-56 sub-issues.
-- ============================================================

-- Step 1 — extend last_completed_step CHECK to include 'pair'.
-- The original constraint from 20260510000001 was created inline
-- with the column, so Postgres auto-named it. IF EXISTS guards
-- against the off-chance the name differs in any environment.
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_last_completed_step_check;
ALTER TABLE agents ADD CONSTRAINT agents_last_completed_step_check
  CHECK (last_completed_step IN ('profile','script','contacts','notify','pair','done'));

COMMENT ON COLUMN agents.last_completed_step IS
  'Onboarding progress marker. NULL = not yet started. Advanced as the agent completes each step. Steps: profile (signup) → script → contacts → notify → pair → done.';

-- Step 2 — pairing_tokens.
-- Single source of truth for an in-flight pair attempt. One agent
-- may have at most one un-consumed un-expired row at a time (the
-- token-issue API revokes prior un-consumed rows on issue, or
-- returns the latest one if minted within the last 60s to avoid
-- two-tab race conditions).
--
-- token_hash holds sha256(raw_token). The raw token is returned to
-- the desktop client once at issue time, used to build the QR /
-- SMS link, and never persisted. Matches the workspace_invites
-- token model.
--
-- consumed_outcome captures the two terminal states from the phone:
--   • push_granted              — phone successfully subscribed
--   • push_denied_but_installed — user declined push but completed
--                                 install / sign-in (desktop still
--                                 flips to "Paired" per spec)
--
-- sms_sends_count + last_sms_sent_at enforce per-token SMS rate
-- limiting (3 sends per token, 1 per 30s). Lives on the row rather
-- than session cookies so it survives multi-tab and multi-device
-- desktop scenarios. Incremented only after Twilio resolves
-- successfully (fail-closed accounting).
CREATE TABLE pairing_tokens (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id           uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token_hash         text NOT NULL UNIQUE,
  expires_at         timestamptz NOT NULL,
  consumed_at        timestamptz,
  consumed_outcome   text CHECK (consumed_outcome IN ('push_granted','push_denied_but_installed')),
  device_label       text,
  sms_sends_count    smallint NOT NULL DEFAULT 0,
  last_sms_sent_at   timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pairing_tokens_agent_id_idx ON pairing_tokens(agent_id);

COMMENT ON TABLE pairing_tokens IS
  'HOR-56: one-time tokens that pair an agent''s phone for web-push. Raw token never stored — token_hash is sha256(raw). Consumed by the phone via /api/onboarding/pairing-complete; the desktop polls /api/onboarding/pairing-status. TTL 15min; revoked on subsequent issue.';

-- Step 3 — push_subscriptions.device_kind.
-- Lets us label the paired-state pill (e.g. "Push is live on your
-- iPhone") and, if needed, target a specific kind in test-push
-- scenarios. Nullable so existing rows are unaffected; the client
-- populates the column on subscribe via savePushSubscription().
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS device_kind text
    CHECK (device_kind IN ('desktop','mobile','tablet','other'));

COMMENT ON COLUMN push_subscriptions.device_kind IS
  'HOR-56: best-guess device class from User-Agent at subscribe time. Used for the paired-state label and future device-targeted pushes. Nullable for backwards compatibility with existing rows.';
