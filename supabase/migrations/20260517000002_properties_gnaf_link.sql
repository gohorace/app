-- ============================================================
-- HOR-191  Core Markets — properties → gnaf link column
--
-- Second of two PR-1 migrations. Adds the FK from public.properties
-- to gnaf.address_principal so a workspace's per-property rows can
-- reference the canonical G-NAF row without duplicating its data.
--
-- The column is nullable because properties created before G-NAF
-- coverage existed (CSV import, manual entry, listing scrapes) have
-- no pid yet. The Core Markets import path (HOR-193) populates this
-- column on INSERT; the address-v2 contact-create path (HOR-117)
-- does not, which is fine — its rows pick up a pid later if the
-- agent's core market import covers the same suburb (an existing
-- residence_only property gets its pid attached via the import-path
-- ON CONFLICT clause).
--
-- ── Quarterly G-NAF refresh and this FK ─────────────────────────
-- The ingest script (scripts/gnaf/ingest.mjs) does an atomic
-- rename-swap of gnaf.address_principal on each refresh. CASCADE
-- drops on the old table also drop this FK constraint (FKs bind to
-- the referenced table's OID, not its name). The script re-creates
-- the constraint inside the same transaction, NOT VALID, so the
-- column never lives without enforcement on new writes. Existing
-- rows aren't re-scanned but typically stay valid because G-NAF
-- address_detail_pids are stable across releases.
-- ============================================================

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS gnaf_address_detail_pid text
    REFERENCES gnaf.address_principal(address_detail_pid)
    ON DELETE SET NULL;

COMMENT ON COLUMN public.properties.gnaf_address_detail_pid IS
  'HOR-191: G-NAF canonical address id. Set at G-NAF import time (HOR-193); null for properties created via listing scrapes, manual entry, or CSV import before G-NAF coverage existed. FK is ON DELETE SET NULL so quarterly G-NAF refresh swaps can rename-replace gnaf.address_principal without breaking the contract.';

-- Non-unique index for "find all properties pointing at this G-NAF
-- row" queries — used by future cross-workspace analytics, not on
-- the hot path. Partial to keep the index small.
CREATE INDEX IF NOT EXISTS properties_gnaf_pid_idx
  ON public.properties (gnaf_address_detail_pid)
  WHERE gnaf_address_detail_pid IS NOT NULL;

-- A workspace shouldn't carry two property rows pointing at the
-- same canonical G-NAF address. Soft-delete-aware partial unique
-- index — mirrors the existing properties_workspace_hash_uidx
-- pattern from 20260511000001.
CREATE UNIQUE INDEX IF NOT EXISTS properties_workspace_gnaf_uidx
  ON public.properties (workspace_id, gnaf_address_detail_pid)
  WHERE gnaf_address_detail_pid IS NOT NULL AND deleted_at IS NULL;
