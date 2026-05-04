-- Add 'website' as a valid crm_source value for contacts created via tracking snippet
ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_crm_source_check;

ALTER TABLE contacts
  ADD CONSTRAINT contacts_crm_source_check
  CHECK (crm_source IN ('rex', 'agentbox', 'manual', 'website'));
