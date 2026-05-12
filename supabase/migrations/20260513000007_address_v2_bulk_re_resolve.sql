-- ============================================================
-- HOR-121  Address Autocomplete v2 — Slice 6: bulk re-resolve legacy
--          contacts to residence_property_id.
--
-- Every non-deleted contact with a legacy `property_address` text value
-- but no `residence_property_id` gets resolved to a property via the
-- hash-only path (no Google enrichment — we don't have place_ids
-- retroactively; the Slice 2 RPC's "enrich on hash hit" path covers
-- lazy enrichment when an agent later edits via autocomplete).
--
-- The Slice 1 sync_contact_suburb trigger fills contacts.suburb from
-- properties.suburb when residence_property_id is set, so contact
-- suburbs end up consistent with their resolved properties.
--
-- Idempotent: re-running this migration is a no-op once contacts have
-- residence_property_id populated.
--
-- See https://linear.app/gohorace/issue/HOR-121
-- ============================================================

DO $$
DECLARE
  v_contact      record;
  v_property_id  uuid;
  v_total        int := 0;
  v_resolved     int := 0;
  v_skipped      int := 0;
  v_errors       int := 0;
BEGIN
  FOR v_contact IN
    SELECT id, workspace_id, property_address, suburb
      FROM contacts
     WHERE property_address IS NOT NULL
       AND residence_property_id IS NULL
       AND deleted_at IS NULL
       AND workspace_id IS NOT NULL
  LOOP
    v_total := v_total + 1;

    BEGIN
      SELECT resolve_residence_property(
        p_workspace_id := v_contact.workspace_id,
        p_suburb       := v_contact.suburb,
        p_raw          := v_contact.property_address
      ) INTO v_property_id;

      IF v_property_id IS NOT NULL THEN
        UPDATE contacts
           SET residence_property_id = v_property_id
         WHERE id = v_contact.id;
        v_resolved := v_resolved + 1;
      ELSE
        -- Function returned NULL (hash couldn't be computed — property_address
        -- and suburb were both effectively empty after normalisation).
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Individual failures don't abort the whole backfill.
      v_errors := v_errors + 1;
      RAISE NOTICE 'Slice 6 backfill: contact % failed: %', v_contact.id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Slice 6 backfill complete. total=%, resolved=%, skipped=%, errors=%',
    v_total, v_resolved, v_skipped, v_errors;
END $$;
