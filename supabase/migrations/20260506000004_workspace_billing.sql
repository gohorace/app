-- ============================================================
-- Workspace billing: Stripe customer + subscription state
-- New workspaces default to plan='free', subscription_status='active'
-- (Free tier is the no-payment baseline). Pro is opt-in via Checkout.
-- On subscription cancellation, the webhook resets to free/active.
-- ============================================================

ALTER TABLE workspaces
  ADD COLUMN stripe_customer_id     text UNIQUE,
  ADD COLUMN stripe_subscription_id text,
  ADD COLUMN subscription_status    text NOT NULL DEFAULT 'active'
    CHECK (subscription_status IN (
      'trialing', 'active', 'past_due', 'canceled',
      'incomplete', 'incomplete_expired', 'unpaid', 'paused'
    )),
  ADD COLUMN current_period_end     timestamptz;

ALTER TABLE workspaces ALTER COLUMN plan SET DEFAULT 'free';
UPDATE workspaces SET plan = 'free' WHERE plan = 'trial';

CREATE INDEX workspaces_stripe_customer_idx
  ON workspaces(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
