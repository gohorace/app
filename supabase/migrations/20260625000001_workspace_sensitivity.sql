-- HOR — Sensitivity dial.
--
-- Replaces the per-agent numeric `sms_threshold_score` knob with a single
-- workspace-level Sensitivity (low | medium | high). One dial governs both the
-- surfaced signal and the "When something stirs" push. Floor events
-- (form_submit, return_visit, inspection_capture, embed_capture,
-- portal_enquiry) keep firing regardless of Sensitivity — they're handled
-- elsewhere in the alert dispatch path and are unaffected by this change.
--
-- Engine wiring: see apps/web/src/lib/sensitivity/thresholds.ts for the
-- effective score-threshold mapping. Cut-offs are config-driven (not product
-- truth) and tunable against real data.

ALTER TABLE public.workspaces
  ADD COLUMN sensitivity text NOT NULL DEFAULT 'medium'
    CHECK (sensitivity IN ('low', 'medium', 'high'));

-- Drop the legacy numeric threshold. No "dangling point values" in the
-- notifications config (acceptance criterion). All existing readers of this
-- column ship in the same change.
ALTER TABLE public.agent_settings
  DROP COLUMN sms_threshold_score;
