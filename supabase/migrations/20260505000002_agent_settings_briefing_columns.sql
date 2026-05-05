-- Timezone and daily briefing hour for scheduled email round-up
ALTER TABLE agent_settings
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Australia/Sydney';

ALTER TABLE agent_settings
  ADD COLUMN IF NOT EXISTS daily_briefing_hour int NOT NULL DEFAULT 17
    CHECK (daily_briefing_hour >= 0 AND daily_briefing_hour <= 23);
