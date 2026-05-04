-- Push alert mode: how the agent wants to receive real-time alerts
ALTER TABLE agent_settings
  ADD COLUMN IF NOT EXISTS push_alert_mode text NOT NULL DEFAULT 'threshold'
    CHECK (push_alert_mode IN ('threshold', 'all', 'hourly_digest'));

-- Multiple briefing email recipients (defaults to agent email if empty)
ALTER TABLE agent_settings
  ADD COLUMN IF NOT EXISTS briefing_emails text[] NOT NULL DEFAULT '{}';
