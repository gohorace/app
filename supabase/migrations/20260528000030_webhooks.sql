-- HOR-323 · Public API v1 — webhooks (contact + relationship events)
--
-- Outbound, signed webhooks for time-sensitive events. Dedicated tables — the
-- Doorstep `destinations`/`delivery_attempts` pair is a different concept
-- (push a captured lead to a CRM); this is event subscriptions. We reuse the
-- delivery-retry *shape* and the Vault secret RPCs (store/get/delete_integration_secret).
--
-- Emission: DB triggers on `contacts` (exposed fields only) and
-- `contact_property_engagement` enqueue one webhook_deliveries row per enabled
-- endpoint subscribed to the event. This catches every write path (embed,
-- inspection, CRM sync, API, the rollup recompute) with no app-layer wiring.
-- The public-shaped payload is built + snapshotted by the worker (TS mappers),
-- not in SQL.
--
-- Delivery: /api/cron/webhook-deliver, driven by pg_cron + pg_net (reusing the
-- core-markets cron secrets — the worker URL is derived from cron_worker_url,
-- so NO new Vault config is needed). HMAC-SHA256 signing happens in the worker.
--
-- ⚠️ Migration drift: apply via Studio SQL editor + manual INSERT of
-- '20260528000030', NOT `supabase db push`, until HOR-131.

BEGIN;

-- ============================================================
-- A. webhook_endpoints
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  url                 text NOT NULL,
  description         text,
  events              text[] NOT NULL DEFAULT '{}',
  secret_id           uuid,            -- pointer to vault.secrets (HMAC signing secret)
  enabled             boolean NOT NULL DEFAULT true,
  status              text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'failing', 'disabled')),
  last_delivery_at    timestamptz,
  last_error          text,
  created_by_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_endpoints_workspace_idx
  ON webhook_endpoints (workspace_id);
-- Hot path for the enqueue trigger: enabled endpoints in a workspace.
CREATE INDEX IF NOT EXISTS webhook_endpoints_enabled_idx
  ON webhook_endpoints (workspace_id) WHERE enabled AND status <> 'disabled';

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "webhook_endpoints_select" ON webhook_endpoints;
CREATE POLICY "webhook_endpoints_select" ON webhook_endpoints
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));
-- Writes via service role only (admin routes).

DROP TRIGGER IF EXISTS webhook_endpoints_updated_at ON webhook_endpoints;
CREATE TRIGGER webhook_endpoints_updated_at
  BEFORE UPDATE ON webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- B. webhook_deliveries — retry state machine
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  endpoint_id     uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id        text NOT NULL,            -- evt_… (opaque, stable across retries)
  event_type      text NOT NULL,
  resource_kind   text NOT NULL CHECK (resource_kind IN ('contact', 'relationship')),
  resource_id     uuid NOT NULL,            -- internal id; the worker maps it to the public shape
  payload         jsonb,                    -- snapshot built on first attempt; null until then
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'delivered', 'exhausted')),
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 6,  -- initial + 5 retries (1m,5m,30m,2h,12h)
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  response_status integer,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Worker hot path: due rows.
CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx
  ON webhook_deliveries (next_attempt_at)
  WHERE status IN ('pending', 'sending');
-- Per-endpoint delivery log (last 30 days view).
CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_idx
  ON webhook_deliveries (endpoint_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_deliveries_workspace_idx
  ON webhook_deliveries (workspace_id, created_at DESC);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "webhook_deliveries_select" ON webhook_deliveries;
CREATE POLICY "webhook_deliveries_select" ON webhook_deliveries
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

DROP TRIGGER IF EXISTS webhook_deliveries_updated_at ON webhook_deliveries;
CREATE TRIGGER webhook_deliveries_updated_at
  BEFORE UPDATE ON webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- C. Enqueue — one delivery per subscribed enabled endpoint
-- ============================================================

CREATE OR REPLACE FUNCTION public.wh_enqueue(
  p_workspace_id  uuid,
  p_event_type    text,
  p_resource_kind text,
  p_resource_id   uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO webhook_deliveries (
    workspace_id, endpoint_id, event_id, event_type, resource_kind, resource_id
  )
  SELECT
    p_workspace_id,
    e.id,
    'evt_' || replace(gen_random_uuid()::text, '-', ''),
    p_event_type,
    p_resource_kind,
    p_resource_id
  FROM webhook_endpoints e
  WHERE e.workspace_id = p_workspace_id
    AND e.enabled = true
    AND e.status <> 'disabled'
    AND p_event_type = ANY(e.events);
END;
$$;

REVOKE ALL ON FUNCTION public.wh_enqueue(uuid, text, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wh_enqueue(uuid, text, text, uuid) TO service_role;

-- contacts → contact.created / contact.updated (exposed fields only)
CREATE OR REPLACE FUNCTION public.wh_contacts_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.wh_enqueue(NEW.workspace_id, 'contact.created', 'contact', NEW.id);
  ELSE
    PERFORM public.wh_enqueue(NEW.workspace_id, 'contact.updated', 'contact', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS wh_contacts_created ON contacts;
CREATE TRIGGER wh_contacts_created
  AFTER INSERT ON contacts
  FOR EACH ROW
  WHEN (NEW.workspace_id IS NOT NULL AND NEW.deleted_at IS NULL)
  EXECUTE FUNCTION public.wh_contacts_trigger();

DROP TRIGGER IF EXISTS wh_contacts_updated ON contacts;
CREATE TRIGGER wh_contacts_updated
  AFTER UPDATE ON contacts
  FOR EACH ROW
  WHEN (
    NEW.workspace_id IS NOT NULL
    AND NEW.deleted_at IS NULL
    AND (
      OLD.email            IS DISTINCT FROM NEW.email
      OR OLD.phone         IS DISTINCT FROM NEW.phone
      OR OLD.first_name    IS DISTINCT FROM NEW.first_name
      OR OLD.last_name     IS DISTINCT FROM NEW.last_name
      OR OLD.external_ids  IS DISTINCT FROM NEW.external_ids
      OR OLD.ingestion_method IS DISTINCT FROM NEW.ingestion_method
    )
  )
  EXECUTE FUNCTION public.wh_contacts_trigger();

-- contact_property_engagement → relationship.created / relationship.updated
CREATE OR REPLACE FUNCTION public.wh_engagement_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.wh_enqueue(NEW.workspace_id, 'relationship.created', 'relationship', NEW.id);
  ELSE
    PERFORM public.wh_enqueue(NEW.workspace_id, 'relationship.updated', 'relationship', NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS wh_engagement_created ON contact_property_engagement;
CREATE TRIGGER wh_engagement_created
  AFTER INSERT ON contact_property_engagement
  FOR EACH ROW
  EXECUTE FUNCTION public.wh_engagement_trigger();

DROP TRIGGER IF EXISTS wh_engagement_updated ON contact_property_engagement;
CREATE TRIGGER wh_engagement_updated
  AFTER UPDATE ON contact_property_engagement
  FOR EACH ROW
  WHEN (
    OLD.last_engaged_at IS DISTINCT FROM NEW.last_engaged_at
    OR OLD.engagement_count IS DISTINCT FROM NEW.engagement_count
  )
  EXECUTE FUNCTION public.wh_engagement_trigger();

-- Trigger functions are SECURITY DEFINER and take no args, so PostgREST
-- exposes them as RPCs — lock them down (triggers fire regardless of EXECUTE
-- grants). Caught by the security advisor on first apply.
REVOKE ALL ON FUNCTION public.wh_contacts_trigger() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.wh_engagement_trigger() FROM public, anon, authenticated;

-- ============================================================
-- D. Claim — atomically lease due deliveries for the worker
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_webhook_deliveries(p_limit integer DEFAULT 50)
RETURNS SETOF webhook_deliveries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE webhook_deliveries d
  SET status = 'sending', attempts = d.attempts + 1, last_attempt_at = now(), updated_at = now()
  WHERE d.id IN (
    SELECT id FROM webhook_deliveries
    WHERE (status = 'pending' AND next_attempt_at <= now())
       -- recover rows stuck 'sending' (worker crashed mid-flight)
       OR (status = 'sending' AND last_attempt_at < now() - interval '2 minutes')
    ORDER BY next_attempt_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING d.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_webhook_deliveries(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_webhook_deliveries(integer) TO service_role;

COMMENT ON TABLE webhook_endpoints IS
  'HOR-323: agency-configured webhook endpoints. Signing secret lives in Vault (secret_id). Events: contact.created/updated, relationship.created/updated.';
COMMENT ON TABLE webhook_deliveries IS
  'HOR-323: per-endpoint delivery attempts with retry state. Payload snapshotted by the worker on first attempt; retries replay it verbatim.';

-- ============================================================
-- E. Schedule the delivery worker (reuses core-markets cron secrets)
-- ============================================================

SET LOCAL search_path = public, cron, net, vault;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'webhook-deliver') THEN
    PERFORM cron.unschedule('webhook-deliver');
  END IF;
END $$;

-- Every minute. Worker URL derived from the existing cron_worker_url secret by
-- swapping the path — no new Vault secret required. Inert until cron_worker_url
-- + cron_secret exist (they already do, from HOR-193).
SELECT cron.schedule(
  'webhook-deliver',
  '* * * * *',
  $cron$
    SELECT net.http_get(
      url := regexp_replace(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_worker_url'),
        '/api/cron/.*$', '/api/cron/webhook-deliver'
      ),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
      ),
      timeout_milliseconds := 8000
    );
  $cron$
);

COMMIT;
