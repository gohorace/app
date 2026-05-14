-- ============================================================
-- HOR-192  Core Markets — onboarding step CHECK widen (3 of 7)
--
-- Add 'core_markets' to the agents.last_completed_step enum so the
-- wizard (HOR-194) can persist this step.
--
-- Slot: between 'script' and 'contacts'. Final order:
--   profile → script → core_markets → contacts → notify → pair → done
--
-- Mirrors 20260516000001_pairing_tokens.sql step 1 — drop the
-- existing CHECK by name (auto-named by Postgres because the
-- original constraint was created inline with the column in
-- 20260510000001) and re-add with the extended set.
-- ============================================================

ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_last_completed_step_check;

ALTER TABLE agents ADD CONSTRAINT agents_last_completed_step_check
  CHECK (last_completed_step IN (
    'profile',
    'script',
    'core_markets',
    'contacts',
    'notify',
    'pair',
    'done'
  ));

COMMENT ON COLUMN agents.last_completed_step IS
  'Onboarding progress marker. NULL = not yet started. Advanced as the agent completes each step. Sequence: profile (signup) → script → core_markets → contacts → notify → pair → done. core_markets is skippable from the wizard; the Properties screen empty state (HOR-195) drives completion when skipped.';
