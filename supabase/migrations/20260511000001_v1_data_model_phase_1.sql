-- ============================================================
-- HOR-65  V1 Data Model & Behaviour — Phase 1: schema foundation (additive)
--
-- Adds the structural foundation for the V1 data model:
--   • New tables: identified_devices, properties, patches,
--     contact_property_relationships, contact_roles, ownership_history
--   • New columns on workspaces, agents, contacts, events
--   • Mechanical backfills from existing data (identity_map, sessions,
--     workspace_members, workspace_settings.snippet_domains,
--     contacts.source/medium, contacts.crm_external_id)
--   • RLS, triggers, indexes
--
-- INTENTIONALLY ADDITIVE. No drops. No writer or reader changes.
-- Phases 2+ swap call-sites onto the new columns; a later cleanup
-- phase drops identity_map / contacts.agent_id.
--
-- Intentional omissions and divergences from the V1 brief:
--   • workspaces.subscription_status / plan are kept as-is. The brief's
--     enum (active/trial/paused/cancelled) is naive about Stripe states;
--     the Stripe-aligned values already in prod (trialing/active/past_due/
--     canceled/incomplete/incomplete_expired/unpaid/paused) are richer
--     and load-bearing for billing.
--   • events.event_type CHECK constraint is left untouched. The new
--     values (link_click, session_start, session_end, portal_enquiry,
--     appraisal_request) are introduced in Phase 2 when writers exist.
--   • The brief's `link_tracking` table is NOT created here. HOR-63
--     already shipped `contact_tracked_links` (one permanent token per
--     contact, no sender-vs-attribution split). Reconciling that model
--     with the brief's per-send link_tracking is a separate ticket.
--   • The brief's `contacts.source` UTM-style enum (portal/social/email/
--     referral/direct/paid_search/...) is NOT applied here. HOR-63 already
--     shipped `contacts.source` with a narrower capture-method enum
--     (portal/crm/website/manual). Renaming the shipped column to
--     `capture_method` and widening `source` is a separate ticket.
--   • Address reconciliation: `properties` becomes the canonical source
--     for addresses. We add `contacts.residence_property_id` (FK) and
--     `residence_only` to properties.status. We do NOT add street/state/
--     postcode columns the original brief had on contacts. We also do
--     NOT drop the existing `contacts.suburb` or `contacts.property_address`
--     in this phase — they're read by get_contacts_list() and the
--     contact API. Phase 2 migrates writers/readers to residence_property_id;
--     cleanup phase drops the legacy columns.
-- ============================================================

BEGIN;

-- ============================================================
-- A. WORKSPACES — new columns + backfill
-- ============================================================

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS default_contact_visibility text NOT NULL DEFAULT 'workspace_view'
    CHECK (default_contact_visibility IN ('owner_only', 'workspace_view', 'workspace_shared')),
  ADD COLUMN IF NOT EXISTS identification_ownership text NOT NULL DEFAULT 'identifying_agent'
    CHECK (identification_ownership IN ('identifying_agent', 'workspace_pool', 'first_touch_agent')),
  ADD COLUMN IF NOT EXISTS domains text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS default_unassigned_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Existing workspaces preserve today's behaviour:
--   visibility = owner_only      → matches current agent-scoped reads
--   ownership  = workspace_pool  → matches current default_agent_id routing
--   domains    ← workspace_settings.snippet_domains (snippet_domains kept
--                                                    until cleanup phase)
UPDATE workspaces w
SET default_contact_visibility  = 'owner_only',
    identification_ownership    = 'workspace_pool',
    default_unassigned_agent_id = w.default_agent_id,
    domains                     = COALESCE(ws.snippet_domains, '{}'::text[])
FROM workspace_settings ws
WHERE ws.workspace_id = w.id;

-- Any workspace without a settings row still flips to owner_only/workspace_pool.
UPDATE workspaces
SET default_contact_visibility = 'owner_only',
    identification_ownership   = 'workspace_pool',
    default_unassigned_agent_id = default_agent_id
WHERE default_contact_visibility = 'workspace_view'
  AND id NOT IN (SELECT workspace_id FROM workspace_settings);

-- ============================================================
-- B. AGENTS — new columns + role backfill + unique
-- ============================================================

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS personal_email text,
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'agent'
    CHECK (role IN ('agent', 'manager', 'admin')),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'invited', 'suspended', 'departed')),
  ADD COLUMN IF NOT EXISTS joined_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS departed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- joined_at: align with created_at on existing rows
UPDATE agents SET joined_at = created_at WHERE joined_at <> created_at;

-- role: derive from workspace_members.role
--   owner  → admin
--   admin  → manager
--   viewer → agent
UPDATE agents a
SET role = CASE wm.role
  WHEN 'owner'  THEN 'admin'
  WHEN 'admin'  THEN 'manager'
  WHEN 'viewer' THEN 'agent'
  ELSE 'agent'
END
FROM workspace_members wm
WHERE wm.user_id = a.user_id AND wm.workspace_id = a.workspace_id;

-- Unique (workspace_id, email) when both present. Allows the same person
-- to exist as an agent across workspaces.
CREATE UNIQUE INDEX IF NOT EXISTS agents_workspace_email_uidx
  ON agents (workspace_id, email)
  WHERE email IS NOT NULL AND workspace_id IS NOT NULL;

-- ============================================================
-- C. CONTACTS — new columns + backfill
--
-- Skipped (already shipped by HOR-63):
--   • source           — exists with CHECK (portal/crm/website/manual)
--   • medium           — exists
-- Both will be reconciled with the brief's broader UTM-style values
-- in a separate ticket (rename shipped column → capture_method,
-- redefine source).
--
-- Skipped (per address reconciliation note — properties is the canonical
-- address store):
--   • street, state, postcode — never added. Address resolution writes
--     to properties; contacts references via residence_property_id (added
--     below after the properties table exists).
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS owner_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS full_name_raw text,
  ADD COLUMN IF NOT EXISTS ingestion_method text
    CHECK (ingestion_method IN (
      'csv_import', 'crm_sync_rex', 'crm_sync_agentbox', 'crm_sync_vaultre',
      'manual', 'identified_visitor', 'form_submit', 'portal_enquiry'
    )),
  ADD COLUMN IF NOT EXISTS source_detail jsonb,
  ADD COLUMN IF NOT EXISTS external_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Backfill workspace + ownership from existing agent_id.
-- ingestion_method derived from the post-HOR-63 (source, medium) pair.
-- external_ids built from (medium, crm_external_id) for CRM-sourced rows;
-- crm_external_id is still in the schema (only crm_source was dropped).
UPDATE contacts c
SET workspace_id        = a.workspace_id,
    owner_agent_id      = c.agent_id,
    created_by_agent_id = c.agent_id,
    ingestion_method    = CASE
      WHEN c.source = 'crm'     AND c.medium = 'rex'      THEN 'crm_sync_rex'
      WHEN c.source = 'crm'     AND c.medium = 'agentbox' THEN 'crm_sync_agentbox'
      WHEN c.source = 'crm'     AND c.medium = 'vaultre'  THEN 'crm_sync_vaultre'
      WHEN c.source = 'website'                           THEN 'identified_visitor'
      WHEN c.source = 'portal'                            THEN 'portal_enquiry'
      WHEN c.source = 'manual'                            THEN 'manual'
      ELSE 'manual'
    END,
    external_ids = CASE
      WHEN c.crm_external_id IS NOT NULL AND c.source = 'crm' AND c.medium IS NOT NULL
        THEN jsonb_build_object(c.medium, c.crm_external_id)
      ELSE '{}'::jsonb
    END
FROM agents a
WHERE a.id = c.agent_id;

-- Per-owner uniqueness — partial, lowercased email, ignores soft-deleted.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_owner_email_uidx
  ON contacts (owner_agent_id, lower(email))
  WHERE email IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_owner_phone_uidx
  ON contacts (owner_agent_id, phone)
  WHERE phone IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS contacts_workspace_idx
  ON contacts (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS contacts_owner_idx
  ON contacts (owner_agent_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS contacts_suburb_idx
  ON contacts (suburb) WHERE deleted_at IS NULL AND suburb IS NOT NULL;

-- ============================================================
-- D. EVENTS — new columns (property_id FK added after properties exist)
--
-- Skipped (already shipped by HOR-63):
--   • link_tracking_id  — the brief's per-send link_tracking table is
--     not created in this phase; contact_tracked_links carries the
--     existing per-contact token model.
-- ============================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS cookie_id text,
  ADD COLUMN IF NOT EXISTS device_fingerprint text,
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS attributed_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suburb text,
  ADD COLUMN IF NOT EXISTS page_url text,
  ADD COLUMN IF NOT EXISTS page_type text
    CHECK (page_type IN ('listing', 'sold', 'suburb_report', 'appraisal', 'contact', 'home', 'other')),
  ADD COLUMN IF NOT EXISTS time_on_page_seconds integer,
  ADD COLUMN IF NOT EXISTS referrer text;

-- Backfill cookie_id (= anonymous_id), contact_id, attributed_agent_id
-- from the existing sessions + identity_map join.
--
-- identity_map allows multiple agents in the same workspace to each
-- claim the same anonymous_id, so we pick the earliest stitch per
-- (workspace_id, anonymous_id) via LATERAL to avoid an UPDATE with
-- ambiguous cardinality. page_url / referrer / time_on_page extracted
-- from the existing properties jsonb where present.
UPDATE events e
SET cookie_id            = s.anonymous_id,
    contact_id           = im.contact_id,
    attributed_agent_id  = im.agent_id,
    page_url             = e.properties->>'url',
    referrer             = NULLIF(e.properties->>'referrer', ''),
    time_on_page_seconds = CASE
      WHEN e.properties ? 'time_on_page'
        AND (e.properties->>'time_on_page') ~ '^[0-9]+$'
        AND (e.properties->>'time_on_page')::int > 0
      THEN (e.properties->>'time_on_page')::int
      ELSE NULL
    END
FROM sessions s
LEFT JOIN LATERAL (
  SELECT contact_id, agent_id
  FROM identity_map
  WHERE workspace_id = s.workspace_id
    AND anonymous_id = s.anonymous_id
  ORDER BY created_at ASC
  LIMIT 1
) im ON true
WHERE s.id = e.session_id;

CREATE INDEX IF NOT EXISTS events_contact_occurred_at_idx
  ON events (contact_id, occurred_at DESC) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_cookie_occurred_at_idx
  ON events (cookie_id, occurred_at DESC) WHERE cookie_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_attributed_agent_idx
  ON events (attributed_agent_id, occurred_at DESC) WHERE attributed_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_workspace_pagetype_idx
  ON events (workspace_id, page_type, occurred_at DESC) WHERE page_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_workspace_suburb_idx
  ON events (workspace_id, suburb, occurred_at DESC) WHERE suburb IS NOT NULL;

-- ============================================================
-- E. PROPERTIES
-- ============================================================

CREATE TABLE IF NOT EXISTS properties (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  street_number     text,
  street_name       text NOT NULL,
  suburb            text NOT NULL,
  state             text NOT NULL,
  postcode          text NOT NULL,
  address_hash      text NOT NULL,
  property_type     text CHECK (property_type IN ('house', 'unit', 'townhouse', 'land', 'commercial', 'unknown')),
  status            text CHECK (status IN ('listed', 'under_offer', 'sold', 'withdrawn', 'off_market', 'residence_only', 'unknown')),
  listing_agent_id  uuid REFERENCES agents(id) ON DELETE SET NULL,
  external_ids      jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS properties_workspace_hash_uidx
  ON properties (workspace_id, address_hash) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS properties_workspace_suburb_idx
  ON properties (workspace_id, suburb) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS properties_listing_agent_idx
  ON properties (listing_agent_id) WHERE listing_agent_id IS NOT NULL AND deleted_at IS NULL;

-- ============================================================
-- F. PATCHES (V1: suburb type only; polygon + property_list = V2)
-- ============================================================

CREATE TABLE IF NOT EXISTS patches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_agent_id    uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name              text NOT NULL,
  type              text NOT NULL DEFAULT 'suburb'
    CHECK (type IN ('suburb', 'custom_polygon', 'property_list')),
  suburbs           text[],
  boundary_geojson  jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patches_owner_idx ON patches (owner_agent_id);
CREATE INDEX IF NOT EXISTS patches_workspace_idx ON patches (workspace_id);

-- ============================================================
-- G. IDENTIFIED_DEVICES
-- ============================================================

CREATE TABLE IF NOT EXISTS identified_devices (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id              uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  device_fingerprint      text,
  cookie_id               text NOT NULL UNIQUE,
  first_identified_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at            timestamptz NOT NULL DEFAULT now(),
  identification_method   text NOT NULL
    CHECK (identification_method IN ('email_link_click', 'form_submit', 'login', 'manual_merge')),
  identified_by_agent_id  uuid REFERENCES agents(id) ON DELETE SET NULL,
  user_agent_summary      text,
  cookie_expires_at       timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS identified_devices_contact_idx
  ON identified_devices (contact_id);
CREATE INDEX IF NOT EXISTS identified_devices_workspace_idx
  ON identified_devices (workspace_id);
CREATE INDEX IF NOT EXISTS identified_devices_fingerprint_idx
  ON identified_devices (device_fingerprint) WHERE device_fingerprint IS NOT NULL;

-- ============================================================
-- H. CONTACT_PROPERTY_RELATIONSHIPS
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_property_relationships (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id           uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  property_id          uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_by_agent_id  uuid NOT NULL REFERENCES agents(id) ON DELETE SET NULL,
  relationship_type    text NOT NULL
    CHECK (relationship_type IN (
      'owner', 'co_owner', 'tenant', 'previous_owner',
      'interested_buyer', 'appraised'
    )),
  confidence           text NOT NULL DEFAULT 'confirmed'
    CHECK (confidence IN ('confirmed', 'likely', 'inferred')),
  source               text NOT NULL
    CHECK (source IN (
      'manual_agent_entry', 'appraisal_record', 'crm_sync',
      'title_search', 'inferred_behaviour'
    )),
  start_date           date,
  end_date             date,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_property_rel_contact_idx
  ON contact_property_relationships (contact_id);
CREATE INDEX IF NOT EXISTS contact_property_rel_property_idx
  ON contact_property_relationships (property_id);
CREATE INDEX IF NOT EXISTS contact_property_rel_workspace_idx
  ON contact_property_relationships (workspace_id);

-- ============================================================
-- I. CONTACT_ROLES
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_roles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id           uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_by_agent_id  uuid NOT NULL REFERENCES agents(id) ON DELETE SET NULL,
  role                 text NOT NULL
    CHECK (role IN ('buyer', 'seller', 'landlord', 'tenant', 'investor', 'past_client')),
  status               text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'dormant', 'closed')),
  confidence           text NOT NULL DEFAULT 'confirmed'
    CHECK (confidence IN ('confirmed', 'likely', 'inferred')),
  source               text NOT NULL
    CHECK (source IN (
      'manual_agent_entry', 'portal_enquiry', 'form_submit',
      'crm_sync', 'appraisal_record', 'inferred_behaviour'
    )),
  started_at           timestamptz NOT NULL DEFAULT now(),
  last_signal_at       timestamptz NOT NULL DEFAULT now(),
  ended_at             timestamptz,
  metadata             jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- One active row per (contact_id, role). Dormant/closed coexist as history.
CREATE UNIQUE INDEX IF NOT EXISTS contact_roles_active_uidx
  ON contact_roles (contact_id, role) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS contact_roles_contact_idx ON contact_roles (contact_id);
CREATE INDEX IF NOT EXISTS contact_roles_workspace_idx ON contact_roles (workspace_id);
CREATE INDEX IF NOT EXISTS contact_roles_last_signal_idx
  ON contact_roles (last_signal_at DESC) WHERE status = 'active';

-- ============================================================
-- J. OWNERSHIP_HISTORY
-- ============================================================

CREATE TABLE IF NOT EXISTS ownership_history (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id               uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  from_agent_id            uuid REFERENCES agents(id) ON DELETE SET NULL,
  to_agent_id              uuid NOT NULL REFERENCES agents(id) ON DELETE SET NULL,
  transferred_by_agent_id  uuid REFERENCES agents(id) ON DELETE SET NULL,
  reason                   text NOT NULL
    CHECK (reason IN (
      'initial_assignment', 'agent_departed', 'manual_reassignment',
      'leave_cover', 'bulk_transfer'
    )),
  notes                    text,
  transferred_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ownership_history_contact_idx
  ON ownership_history (contact_id, transferred_at DESC);
CREATE INDEX IF NOT EXISTS ownership_history_workspace_idx
  ON ownership_history (workspace_id, transferred_at DESC);

-- ============================================================
-- K. LATE FK ADDITIONS — now that properties table exists
-- ============================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES properties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS events_property_occurred_at_idx
  ON events (property_id, occurred_at DESC) WHERE property_id IS NOT NULL;

-- Per the address reconciliation note: properties is the canonical address
-- store. Contacts reference a single residence property via this FK.
-- ON DELETE SET NULL so a property purge doesn't blow away contact rows.
-- Phase 2 wires writers (CSV import, manual entry, form submit with
-- address fields) to populate this via the (workspace_id, address_hash)
-- resolution function. Phase 2 also migrates get_contacts_list() and the
-- contact API to read address from the joined property. Cleanup phase
-- drops the legacy contacts.suburb and contacts.property_address columns
-- once nothing reads them.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS residence_property_id uuid REFERENCES properties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS contacts_residence_property_idx
  ON contacts (residence_property_id)
  WHERE residence_property_id IS NOT NULL AND deleted_at IS NULL;

-- ============================================================
-- L. TRIGGERS
--
-- Reuses set_updated_at() defined in 20260408000003_scoring_functions_v2.sql.
-- DROP IF EXISTS makes the migration idempotent if re-run after a partial failure.
-- ============================================================

DROP TRIGGER IF EXISTS workspaces_updated_at ON workspaces;
CREATE TRIGGER workspaces_updated_at
  BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS agents_updated_at ON agents;
CREATE TRIGGER agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS contacts_updated_at ON contacts;
CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS properties_updated_at ON properties;
CREATE TRIGGER properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS patches_updated_at ON patches;
CREATE TRIGGER patches_updated_at
  BEFORE UPDATE ON patches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS identified_devices_updated_at ON identified_devices;
CREATE TRIGGER identified_devices_updated_at
  BEFORE UPDATE ON identified_devices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS contact_property_relationships_updated_at ON contact_property_relationships;
CREATE TRIGGER contact_property_relationships_updated_at
  BEFORE UPDATE ON contact_property_relationships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS contact_roles_updated_at ON contact_roles;
CREATE TRIGGER contact_roles_updated_at
  BEFORE UPDATE ON contact_roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Keep contacts.workspace_id in sync with the owner agent's workspace.
-- Runs before insert and before any update that touches owner_agent_id.
CREATE OR REPLACE FUNCTION sync_contact_workspace_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.owner_agent_id IS NOT NULL AND (
       TG_OP = 'INSERT' OR NEW.owner_agent_id IS DISTINCT FROM OLD.owner_agent_id
  ) THEN
    SELECT workspace_id INTO NEW.workspace_id
    FROM agents
    WHERE id = NEW.owner_agent_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_sync_workspace_id ON contacts;
CREATE TRIGGER contacts_sync_workspace_id
  BEFORE INSERT OR UPDATE OF owner_agent_id ON contacts
  FOR EACH ROW EXECUTE FUNCTION sync_contact_workspace_id();

-- ============================================================
-- M. RLS — workspace-scoped read for new tables
--
-- Writes are handled by service-role keys via ingestion endpoints
-- or by API routes that already authenticate users; we don't grant
-- broad insert/update via RLS in this slice. Phase 2+ adds specific
-- write policies as call-sites land.
-- ============================================================

ALTER TABLE identified_devices             ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE patches                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_property_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_roles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ownership_history              ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "identified_devices_select" ON identified_devices;
CREATE POLICY "identified_devices_select" ON identified_devices
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

DROP POLICY IF EXISTS "properties_select" ON properties;
CREATE POLICY "properties_select" ON properties
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

DROP POLICY IF EXISTS "patches_select" ON patches;
CREATE POLICY "patches_select" ON patches
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

DROP POLICY IF EXISTS "contact_property_relationships_select" ON contact_property_relationships;
CREATE POLICY "contact_property_relationships_select" ON contact_property_relationships
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

DROP POLICY IF EXISTS "contact_roles_select" ON contact_roles;
CREATE POLICY "contact_roles_select" ON contact_roles
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

DROP POLICY IF EXISTS "ownership_history_select" ON ownership_history;
CREATE POLICY "ownership_history_select" ON ownership_history
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

-- ============================================================
-- N. COMMENTS — schema reviewability
-- ============================================================

COMMENT ON COLUMN workspaces.default_contact_visibility IS
  'Workspace-wide default for contact visibility. Existing workspaces are backfilled to owner_only to preserve today''s behaviour; new workspaces default to workspace_view per V1 brief.';
COMMENT ON COLUMN workspaces.identification_ownership IS
  'How new contacts are routed when first identified. Existing workspaces backfilled to workspace_pool (current default_agent_id); new workspaces default to identifying_agent.';
COMMENT ON COLUMN workspaces.domains IS
  'First-party tracking domains. Backfilled from workspace_settings.snippet_domains, which is retained until the cleanup phase.';
COMMENT ON COLUMN contacts.workspace_id IS
  'Denormalised from owner_agent_id.workspace_id. Kept in sync by trigger contacts_sync_workspace_id.';
COMMENT ON COLUMN contacts.owner_agent_id IS
  'Current owning agent. Changes via ownership transfer; ownership_history records every change.';
COMMENT ON COLUMN contacts.created_by_agent_id IS
  'Immutable. The agent who originally created the contact record.';
COMMENT ON COLUMN contacts.ingestion_method IS
  'How the contact got into Horace. Backfilled from the HOR-63 (source, medium) pair: source=crm/medium=rex → crm_sync_rex, source=website → identified_visitor, source=portal → portal_enquiry, etc.';
COMMENT ON COLUMN contacts.residence_property_id IS
  'The property record for this contact''s residence address. Properties is the canonical address store. Phase 2 populates this via the same (workspace_id, address_hash) resolution used for listings. Legacy contacts.suburb and contacts.property_address remain populated by old writers until Phase 2 migrates them and the cleanup phase drops them.';
COMMENT ON COLUMN events.attributed_agent_id IS
  'Immutable once set. The agent whose action produced this event (listing agent, link sender, contact owner at time of event, or default_unassigned_agent_id).';
COMMENT ON TABLE identified_devices IS
  'Replaces identity_map functionally in later phases. Phase 1 creates the table; Phase 2 dual-writes; cleanup drops identity_map.';

COMMIT;
