-- ============================================================
-- HOR-130  Add metadata JSONB column to properties.
--
-- Properties currently has no metadata bucket — same gap contacts
-- had before HOR-65 added `contacts.metadata`. This blocks any
-- per-property user-editable data (notes, tags, custom keys).
--
-- This migration adds the column with a default of '{}'::jsonb so
-- existing rows pick up a valid value without backfill work.
--
-- The first consumer is the inline notes editor on the property
-- detail page (HOR-130). PATCH /api/properties/:id will store notes
-- at `metadata.notes`, mirroring the contacts.metadata pattern used
-- for roles.
-- ============================================================

BEGIN;

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN properties.metadata IS
  'Per-workspace structured metadata. Today: { notes?: string }. Future: tags, custom keys, integration-supplied attributes.';

COMMIT;
