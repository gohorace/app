-- ============================================================
-- HOR-116  Address Autocomplete v2 — Slice 1: schema foundation
--
-- Additive on `properties` (three new nullable columns for Google
-- Places data). Semantic repurpose of the existing legacy
-- `contacts.suburb` column from user-editable input to a
-- denormalised cache fed by `residence_property_id → properties.suburb`.
--
-- No app writers wired yet — those land in Slices 2+.
--
-- See https://linear.app/gohorace/issue/HOR-116
-- ============================================================

BEGIN;

-- ---------- properties: Google fields ------------------------------------
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS google_place_id text,
  ADD COLUMN IF NOT EXISTS latitude        decimal(10, 7),
  ADD COLUMN IF NOT EXISTS longitude       decimal(10, 7);

COMMENT ON COLUMN properties.google_place_id IS
  'Stable identifier from Google Places. Primary dedup key for autocomplete-sourced addresses; null for properties created via listing parsing or CSV import (enriched lazily when an agent later edits the same address via autocomplete).';
COMMENT ON COLUMN properties.latitude IS
  'Latitude in decimal degrees with ~1cm precision. Populated when an address is captured via Google Places autocomplete.';
COMMENT ON COLUMN properties.longitude IS
  'Longitude in decimal degrees with ~1cm precision. Populated when an address is captured via Google Places autocomplete.';

-- Partial unique index — primary dedup key for autocomplete entries.
CREATE UNIQUE INDEX IF NOT EXISTS properties_workspace_place_id_uidx
  ON properties (workspace_id, google_place_id)
  WHERE google_place_id IS NOT NULL AND deleted_at IS NULL;

-- ---------- contacts.suburb: hot-path index for suburb signal queries ----
-- The column itself already exists (legacy, pre-HOR-65). HOR-65's brief
-- promised the cleanup phase would drop it; instead this slice repurposes
-- it as a denormalised cache so suburb-level queries don't have to join
-- properties on the hot path.
CREATE INDEX IF NOT EXISTS contacts_workspace_suburb_idx
  ON contacts (workspace_id, suburb)
  WHERE deleted_at IS NULL;

-- ---------- Trigger: keep contacts.suburb in sync with residence_property
-- Fires BEFORE INSERT and BEFORE UPDATE on contacts. The cache is rewritten
-- only when residence_property_id is set/changed (or cleared); rows whose
-- residence is unchanged on an UPDATE keep their suburb value as-is.
--
-- On INSERT: if residence_property_id is non-null, look up properties.suburb
-- and write to NEW.suburb. (If null, NEW.suburb keeps whatever the writer
-- supplied — legacy user-input path during the transition window.)
--
-- On UPDATE: only act when residence_property_id changed.
--   • new value non-null → overwrite NEW.suburb from the joined property
--   • new value null → clear NEW.suburb
CREATE OR REPLACE FUNCTION sync_contact_suburb()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.residence_property_id IS NOT NULL THEN
      SELECT suburb INTO NEW.suburb
        FROM properties
       WHERE id = NEW.residence_property_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.residence_property_id IS DISTINCT FROM OLD.residence_property_id THEN
      IF NEW.residence_property_id IS NULL THEN
        NEW.suburb := NULL;
      ELSE
        SELECT suburb INTO NEW.suburb
          FROM properties
         WHERE id = NEW.residence_property_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_sync_suburb ON contacts;
CREATE TRIGGER contacts_sync_suburb
  BEFORE INSERT OR UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION sync_contact_suburb();

-- ---------- Trigger: when a property's suburb changes, propagate to deps
-- Properties' suburbs essentially never change, but a rename or correction
-- needs to flow through to every contact referencing this property.
-- AFTER UPDATE so the new value is visible; only fires when suburb changed.
CREATE OR REPLACE FUNCTION sync_contacts_suburb_on_property_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.suburb IS DISTINCT FROM OLD.suburb THEN
    UPDATE contacts
       SET suburb = NEW.suburb
     WHERE residence_property_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_propagate_suburb ON properties;
CREATE TRIGGER properties_propagate_suburb
  AFTER UPDATE OF suburb ON properties
  FOR EACH ROW EXECUTE FUNCTION sync_contacts_suburb_on_property_change();

COMMIT;
