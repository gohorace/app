-- Migration: Add property_address to contacts
-- Stores the home address of the contact — the property they own and may list
-- for sale in future. Captured manually or auto-populated from appraisal form
-- submissions via the tracking snippet.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS property_address text;

COMMENT ON COLUMN contacts.property_address IS
  'The home address owned by this contact — a future potential listing.';
