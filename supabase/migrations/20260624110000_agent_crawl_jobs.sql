-- ============================================================
-- HOR-385 (P1) — Agent site crawl job queue
--
-- Claim-one-job queue for the site crawler, mirroring the Core Markets
-- import pattern (20260517000004 + ...000009): status machine +
-- heartbeat-based stale reclaim + FOR UPDATE SKIP LOCKED claim RPC.
--
-- Unlike Core Markets (pure in-DB work over gnaf tables), crawling needs
-- HTTP fetches that can only run in the Next.js route. So the job carries
-- its work across cron ticks: the first tick discovers the sitemap and
-- fills `url_queue`; subsequent ticks drain a batch of URLs each. A 500-page
-- site finishes across several minutes, never blowing the 60s function cap.
--
-- Enqueue sources:
--   • connect  — trigger when agent_settings.website_url is first set / changed
--                (the P0 persist-on-probe flow, HOR-384)
--   • nightly  — enqueue_nightly_crawls() called by pg_cron once a day
--   • manual   — reserved for ops / re-crawl
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_crawl_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id       uuid NOT NULL REFERENCES agents(id)     ON DELETE CASCADE,
  website_url    text NOT NULL,
  kind           text NOT NULL DEFAULT 'manual'
    CHECK (kind IN ('connect', 'nightly', 'manual')),
  status         text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'complete', 'error')),
  -- Remaining work. NULL = not yet discovered (the route is in the discover
  -- phase); a JSON array of {url, type} once the sitemap has been read.
  url_queue      jsonb,
  total_urls     integer NOT NULL DEFAULT 0,
  pages_crawled  integer NOT NULL DEFAULT 0,
  listings_found integer NOT NULL DEFAULT 0,
  sold_found     integer NOT NULL DEFAULT 0,
  reports_found  integer NOT NULL DEFAULT 0,
  error          text,
  enqueued_at    timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  completed_at   timestamptz,
  -- Worker heartbeat, refreshed each tick. A 'running' row with a heartbeat
  -- older than 5 min is re-claimable (worker crash / timeout).
  heartbeat_at   timestamptz
);

-- Cron-hot index: the claim path filters to pending/running by enqueue order.
CREATE INDEX IF NOT EXISTS agent_crawl_jobs_status_idx
  ON agent_crawl_jobs (status, enqueued_at)
  WHERE status IN ('pending', 'running');

-- "Recent crawls for this agent" — ops + the dedupe check in the trigger.
CREATE INDEX IF NOT EXISTS agent_crawl_jobs_agent_idx
  ON agent_crawl_jobs (agent_id, enqueued_at DESC);

ALTER TABLE agent_crawl_jobs ENABLE ROW LEVEL SECURITY;

-- Workspace members can read their crawl jobs; all writes go via the admin
-- client + the claim RPC (service-role), never from the browser.
DROP POLICY IF EXISTS "agent_crawl_jobs_select" ON agent_crawl_jobs;
CREATE POLICY "agent_crawl_jobs_select" ON agent_crawl_jobs
  FOR SELECT USING (workspace_id = ANY(public.user_workspace_ids()));

-- ─── Claim RPC ──────────────────────────────────────────────────────
-- Atomically claim one job: a pending row, or a running row whose worker
-- went dark (heartbeat older than 5 min). Mirrors claim_core_market_import.
CREATE OR REPLACE FUNCTION public.claim_agent_crawl_job()
RETURNS SETOF public.agent_crawl_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id
      FROM agent_crawl_jobs
     WHERE status = 'pending'
        OR (status = 'running' AND heartbeat_at < now() - interval '5 minutes')
     ORDER BY enqueued_at
     LIMIT 1
       FOR UPDATE SKIP LOCKED
  )
  UPDATE agent_crawl_jobs
     SET status       = 'running',
         started_at   = COALESCE(started_at, now()),
         heartbeat_at = now()
   WHERE id IN (SELECT id FROM claimed)
   RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agent_crawl_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_agent_crawl_job() TO service_role;

-- ─── Enqueue helper ─────────────────────────────────────────────────
-- Insert a pending job unless the agent already has one in flight
-- (pending or running). Returns the job id, or NULL if skipped.
CREATE OR REPLACE FUNCTION public.enqueue_agent_crawl(
  p_agent_id uuid,
  p_kind     text DEFAULT 'manual'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_workspace_id uuid;
  v_url          text;
  v_job_id       uuid;
BEGIN
  SELECT a.workspace_id, s.website_url
    INTO v_workspace_id, v_url
    FROM agents a
    JOIN agent_settings s ON s.agent_id = a.id
   WHERE a.id = p_agent_id;

  -- No agent, no workspace, or no site to crawl → nothing to do.
  IF v_workspace_id IS NULL OR v_url IS NULL OR length(trim(v_url)) = 0 THEN
    RETURN NULL;
  END IF;

  -- Don't pile up duplicate jobs for the same agent.
  IF EXISTS (
    SELECT 1 FROM agent_crawl_jobs
     WHERE agent_id = p_agent_id AND status IN ('pending', 'running')
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO agent_crawl_jobs (workspace_id, agent_id, website_url, kind)
  VALUES (v_workspace_id, p_agent_id, trim(v_url), p_kind)
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_agent_crawl(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_agent_crawl(uuid, text) TO service_role;

-- ─── Connect trigger ────────────────────────────────────────────────
-- When website_url is first set or changed (HOR-384 persists it from the
-- onboarding probe), enqueue a one-off connect crawl. Fires on INSERT and on
-- UPDATE where the URL actually changed to a non-empty value.
CREATE OR REPLACE FUNCTION public.enqueue_crawl_on_website_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.website_url IS NOT NULL
     AND length(trim(NEW.website_url)) > 0
     AND (TG_OP = 'INSERT' OR NEW.website_url IS DISTINCT FROM OLD.website_url)
  THEN
    PERFORM public.enqueue_agent_crawl(NEW.agent_id, 'connect');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_settings_enqueue_crawl ON agent_settings;
CREATE TRIGGER agent_settings_enqueue_crawl
  AFTER INSERT OR UPDATE OF website_url ON agent_settings
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_crawl_on_website_change();

-- ─── Nightly enqueue ────────────────────────────────────────────────
-- Enqueue a nightly crawl for every agent with a site, skipping any that
-- already have a job in flight. Called by pg_cron once a day. Returns the
-- number of jobs enqueued.
CREATE OR REPLACE FUNCTION public.enqueue_nightly_crawls()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  INSERT INTO agent_crawl_jobs (workspace_id, agent_id, website_url, kind)
  SELECT a.workspace_id, a.id, trim(s.website_url), 'nightly'
    FROM agents a
    JOIN agent_settings s ON s.agent_id = a.id
   WHERE s.website_url IS NOT NULL
     AND length(trim(s.website_url)) > 0
     AND a.workspace_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM agent_crawl_jobs j
        WHERE j.agent_id = a.id AND j.status IN ('pending', 'running')
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_nightly_crawls() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_nightly_crawls() TO service_role;
