-- ============================================================
-- HOR-onboarding-v2  agents.onboarding_flow
--
-- Records which onboarding shell an agent is using:
--   'agentic' — conversational v2 (default for new agents)
--   'classic' — the v1 6-step wizard
--
-- The chooser at /onboarding reads this column and redirects to
-- /onboarding/agentic or /onboarding/classic. New agents default to
-- 'agentic'. The persistent "Use the classic setup instead" link in
-- the v2 shell fire-and-forgets a write that flips this to 'classic'
-- so reloads stick.
--
-- Resume across flows is handled by the existing last_completed_step
-- column (added in 20260510000001, widened in 20260517000005); turn N
-- in v2 maps 1:1 to step N in v1.
-- ============================================================

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS onboarding_flow text NOT NULL DEFAULT 'agentic'
    CHECK (onboarding_flow IN ('agentic', 'classic'));

COMMENT ON COLUMN agents.onboarding_flow IS
  'Which onboarding shell the agent is using. Defaults to agentic for new agents. Flipped to classic when the agent taps the persistent escape hatch in the v2 shell, so subsequent reloads of /onboarding go straight to the classic wizard.';
