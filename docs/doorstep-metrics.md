# Doorstep — success metrics

Four metrics from the brief, each queryable with the schema + telemetry shipped across HOR-145 through HOR-156. No new tables; everything below builds on `inspections`, `inspection_scans`, `events`, `notification_log`, and the structured log lines documented at the end.

| Metric | Target | Source | Computed from |
| - | - | - | - |
| Scan-to-submit conversion | >70% | Vercel logs + DB | `doorstep_event=inspection_page_view` count vs `inspection_scans` count, per inspection |
| Submit → agent nudge latency | <5s p95 | Vercel logs | `doorstep_event=inspection_capture_ok.total_ms` |
| 14-day device revisit rate | directional | DB | `inspection_scans` joined to `events` |
| 30-day nudge generation rate | payoff | DB | `inspection_scans` joined to `notification_log` |

The brief frames these as v1 instrumentation — exposed via SQL queries and log search rather than a dashboard. Build a dashboard later if these numbers start driving decisions.

---

## 1. Scan-to-submit conversion

> "Of the prospects who scanned the QR, how many submitted the form?"

**Denominator (scans / page views):** Vercel log search filtered to:

```
doorstep_event=inspection_page_view
```

Each `/i/<token>` server render emits one line:

```json
{ "doorstep_event": "inspection_page_view", "inspection_id": "<uuid>", "inspection_type": "open_home", "workspace_id": "<uuid>", "ts": "..." }
```

Group by `inspection_id` to get scans per inspection. Or use the `time:` window for an aggregate.

**Numerator (submits):** `inspection_scans` table — every row is a successful capture.

**Per-inspection ratio:**

```sql
SELECT
  i.id,
  i.scheduled_at,
  /* page views come from Vercel logs — substitute your log-aggregation result here */
  count(s.*) AS submits
FROM inspections i
LEFT JOIN inspection_scans s ON s.inspection_id = i.id
WHERE i.deleted_at IS NULL
  AND i.scheduled_at > now() - interval '30 days'
GROUP BY i.id, i.scheduled_at
ORDER BY i.scheduled_at DESC;
```

**Caveats:**

- Prefetch + cancelled-navigation page views also emit the log line, so the denominator reads slightly hot. Acceptable for a directional metric; correct it by deduping per (anonymous_id, inspection_id) if it matters later.
- The page-view log doesn't carry the prospect's `_riq_aid` — we'd need to wire that through the public page if we want per-device conversion.

---

## 2. Submit → agent nudge latency

> "How fast does the agent feel the buzz after the prospect taps Done?"

**Source:** Vercel log search filtered to:

```
doorstep_event=inspection_capture_ok
```

Each accepted submit emits one line:

```json
{
  "doorstep_event": "inspection_capture_ok",
  "inspection_token": "<8 chars>",
  "contact_id": "<uuid>",
  "agent_id": "<uuid>",
  "is_new_scan": true,
  "session_ms": 12,
  "rpc_ms": 84,
  "push_ms": 210,
  "total_ms": 306,
  "ts": "..."
}
```

**Metric:** p50 / p95 of `total_ms` over a rolling window. Filter `is_new_scan=true` to exclude repeat-submits (which skip the push and so don't reflect real latency).

**Notes:**

- `total_ms` covers the **server-side path** (session upsert → RPC → push dispatch). It does **not** include the prospect's network roundtrip or the push provider's delivery time to the agent's phone. The brief's <5s target is end-to-end as perceived by the agent; `total_ms` is a conservative subset — if it's under 1s we're almost certainly under 5s perceived.
- `push_ms` will be the dominant component once VAPID is properly warm. If it gets fat (>1s), revisit `sendWebPush` — likely a Vercel-region vs push-endpoint round trip.

---

## 3. 14-day device revisit rate

> "Of the prospects we captured at an inspection, how many came back to the agent's site within 14 days?"

```sql
WITH window_scans AS (
  SELECT s.contact_id, s.captured_at, i.agent_id, i.workspace_id
  FROM inspection_scans s
  JOIN inspections i ON i.id = s.inspection_id
  WHERE s.captured_at BETWEEN now() - interval '14 days' AND now()
    AND i.deleted_at IS NULL
),
revisits AS (
  SELECT DISTINCT ws.contact_id
  FROM window_scans ws
  JOIN events e ON e.contact_id = ws.contact_id
  WHERE e.occurred_at > ws.captured_at
    AND e.occurred_at <= ws.captured_at + interval '14 days'
)
SELECT
  (SELECT count(*) FROM revisits)::float
    / NULLIF((SELECT count(DISTINCT contact_id) FROM window_scans), 0) AS revisit_rate;
```

**Caveat — cross-domain attribution:** Doorstep captures set `_riq_aid` on `gohorace.com` (the capture page's host), not on the agent's tracked website. So a captured prospect later visiting `agentname.com.au` doesn't link back via cookie — they get a fresh tracker cookie there, and `events.contact_id` doesn't bind. **In v1 this metric will read close to zero until per-agent custom domains land in v2.** Documented intentionally; flagged in HOR-151's PR (#72).

---

## 4. 30-day nudge generation rate

> "Of the contacts captured via Doorstep, how many generated at least one Horace nudge within 30 days?"

```sql
WITH doorstep_contacts AS (
  SELECT id, created_at, owner_agent_id
  FROM contacts
  WHERE ingestion_method = 'inspection_capture'
    AND created_at BETWEEN now() - interval '30 days' AND now()
    AND deleted_at IS NULL
),
nudged AS (
  SELECT DISTINCT nl.contact_id
  FROM notification_log nl
  JOIN doorstep_contacts dc ON dc.id = nl.contact_id
  WHERE nl.type LIKE 'alert\_%' ESCAPE '\'
    AND nl.sent_at > dc.created_at
    AND nl.sent_at <= dc.created_at + interval '30 days'
)
SELECT
  (SELECT count(*) FROM nudged)::float
    / NULLIF((SELECT count(*) FROM doorstep_contacts), 0) AS nudge_rate;
```

**What counts as a nudge:** any `notification_log.type` starting with `alert_*`. That deliberately includes the capture push itself (`alert_inspection_capture`) — every Doorstep contact gets at least one nudge by construction, so this metric reads ~100% in v1. To tighten to *post-capture* nudges, exclude `alert_inspection_capture`:

```sql
AND nl.type NOT IN ('alert_inspection_capture')
```

That gives the share who generated a *follow-up* signal — the more useful payoff metric.

---

## Telemetry log lines

The two structured-JSON log events HOR-158 wires into the Doorstep paths:

| Log event | Emitted from | Fields |
| - | - | - |
| `inspection_page_view` | `app/i/[token]/page.tsx` on every server render | `inspection_id`, `inspection_type`, `workspace_id`, `ts` |
| `inspection_capture_ok` | `app/api/inspections/capture/route.ts` on every successful submit | `inspection_token`, `contact_id`, `agent_id`, `is_new_scan`, `session_ms`, `rpc_ms`, `push_ms`, `total_ms`, `ts` |

Both are plain `console.log(JSON.stringify(...))` so they land in Vercel's log stream without any dependency. If we wire in a real telemetry pipe (Datadog, OpenTelemetry, etc.) later, both call sites are single-line swaps.

---

## What we did NOT build in v1

- A `doorstep_metrics_snapshot()` RPC. Premature for v1 — these queries are run by humans for now.
- A dashboard. SQL + log search is enough until someone asks for the numbers on a recurring basis.
- Per-device conversion tracking (would need the prospect's `_riq_aid` threaded into the `inspection_page_view` log).
- Event-typed page views in the `events` table. The brief suggested emitting a row, but it'd require a session upsert (events.session_id NOT NULL FK) and add a table-write per page view. Log lines are cheaper.

Revisit any of these when there's evidence the current shape isn't enough.
