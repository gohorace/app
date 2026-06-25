-- HTML email signature (HOR-xxx).
--
-- Adds:
--   • email_signature_html      — sanitised HTML signature (the editor's output).
--   • email_signature_logo_url  — optional public image URL for the logo.
--
-- email_signature is retained as a derived plain-text fallback for legacy
-- consumers (lib/ai/signal-draft.ts, lib/outreach/draft-outreach.ts,
-- lib/mcp/tools.ts, lib/mcp/profile.ts) that concatenate the signature into
-- plain-text bodies. On save the editor derives plain-text from the HTML so
-- both columns stay in sync.

ALTER TABLE public.agent_settings
  ADD COLUMN IF NOT EXISTS email_signature_html     text,
  ADD COLUMN IF NOT EXISTS email_signature_logo_url text;

COMMENT ON COLUMN public.agent_settings.email_signature_html IS
  'Sanitised HTML signature from the rich-text editor. Rendered into outbound HTML bodies. email_signature carries the derived plain-text fallback.';

COMMENT ON COLUMN public.agent_settings.email_signature_logo_url IS
  'Optional public image URL for the signature logo. Composed into email_signature_html at render time, not stored inline.';
