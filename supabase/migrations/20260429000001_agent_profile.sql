-- ============================================================
-- Migration 012: Agent profile fields
-- Brand voice + signature + website + market positioning, used by
-- the MCP outreach tools so Claude writes in the agent's voice.
-- A "complete profile" requires brand_voice + email_signature;
-- the rest are optional.
-- ============================================================

ALTER TABLE agent_settings
  ADD COLUMN brand_voice        text,
  ADD COLUMN email_signature    text,
  ADD COLUMN website_url        text,
  ADD COLUMN market_positioning text;
