# ADR 0001 — Inbound email infrastructure

**Status:** Accepted
**Date:** 2026-05-10
**Linear:** [HOR-28](https://linear.app/gohorace/issue/HOR-28) (spike) → [HOR-63](https://linear.app/gohorace/issue/HOR-63) (production)

## Context

Horace needs to capture portal enquiries (REA, Domain) into agent workspaces as structured contacts. Real-estate portals route enquiries by email — agents add destination addresses to their listings, and the portal sends a templated enquiry email there when a buyer submits the form.

We needed to choose:

* The provider that receives inbound mail at our domain
* The address scheme exposed to agents
* The parsing strategy for portal-specific email templates
* The webhook auth posture

## Decision

* **Provider: Resend.** Receives inbound at `*@portal.gohorace.com` via MX records. We were already paying for Resend Pro for outbound (briefing emails, magic-link auth), and adding inbound to the same account avoided a second ESP's operational tax.
* **Architecture: webhook + body fetch.** Resend's `email.received` webhook delivers metadata only (small, fast). We then call `GET /emails/receiving/{id}` with a receiving-scoped API key to fetch `text` / `html` / `headers` / `reply_to`. Both payloads are stored in `inbound_emails.webhook_payload` and `.fetched_payload`.
* **Address scheme: per-agent opaque.** Each agent gets a 10-character nanoid local part (e.g. `k7m3xq9p2n@portal.gohorace.com`), stored in `agent_inbound_addresses` and scoped to the agent (not the workspace). Routing is unambiguous: `local_part → agent_id → workspace_id`.
* **Parser strategy: per-portal template parsers.** REA's body is a templated `Key: value\n` format with paragraph-separated blocks. Trivially parsed with a regex/section split. Each portal gets its own parser module dispatched on the `source_portal` field (heuristic from the sender domain).
* **Attribution: UTM-style `(source, medium)`** on `contacts`, replacing the previous single `crm_source` enum. Portal contacts get `source='portal'`, `medium='rea'` (or `'domain'`).
* **Webhook auth: svix signature verification.** `RESEND_INBOUND_SIGNING_SECRET` is the shared secret; the route reads the raw body and verifies via the `svix` npm package. Fails closed if the secret is unset.

## Rationale

The HOR-28 spike was scoped to validate Resend's parsing quality against real REA enquiry emails before locking in the provider choice. Result: **11/11 fields extractable** from a real REA enquiry — Property ID, full street address, listing agent, enquirer name/email/phone/message, buyer intent, requested actions. Enquirer email also lands in `reply_to` header, so we don't even need body parsing for the canonical case.

That made the provider choice easy:

* Resend already paid for. No second ESP to manage.
* Parser quality already verified against real production data.
* Body fetch via separate API call is a sensible architecture (small webhook payloads, body on demand) that scales fine for our volume.
* Auth/deliverability posture validated: REA passes SPF, double-DKIM (their domain + Amazon SES), and DMARC.

The per-agent address scheme came from a multi-user-workspace concern: when an agency has 5 agents, attributing a contact based on a parsed listing-agent name in the email body is fuzzy-matching territory that breaks silently. Per-agent addresses make routing unambiguous — no name-matching needed.

## Consequences

### Positive

* Single ESP, single DNS surface for both inbound and outbound.
* Parser is a pure function over the fetched payload — easy to unit test against captured real samples.
* `(source, medium)` attribution model scales to new portals (Domain, off-market, etc.) and surfaces (CRM, manual, website tracker) without further schema changes.
* Webhook is svix-verified and fail-closed.

### Negative

* **Per-portal parser maintenance.** Each new portal we support needs its own parser module. Mitigation: REA's templated format is stable and other portals are likely similar; the dispatcher pattern isolates per-portal complexity.
* **1-hour raw MIME expiry.** Resend serves the raw email body via a signed CloudFront URL with a 1-hour TTL. We do not currently fetch and persist raw MIME. Acceptable because `text` + `html` + `headers` covers our parsing needs; if we later need raw (e.g., forensics, attachment recovery) we'd need to fetch on receipt.
* **Single-provider risk.** Resend outage = inbound capture down for the duration. No fallback. Acceptable at current scale (~1 agent, 10–50 enquiries/day); revisit if we scale to 1000+ enquiries/day or paying customers depend on the inbound channel.
* **Receiving address must be set per-listing in the portal admin.** No automated onboarding flow yet — agents (or their admins) manually add the Horace portal address to each listing alongside their existing emails (their own + Rex's lead-capture). Mitigation: `agent_inbound_addresses` table allows multiple addresses per agent (rotation, replacement), and the address is opaque so agents only need to copy it once.

## Alternatives considered

### Postmark for inbound, Resend for outbound

Postmark has a strong reputation for inbound parsing, but adding a second ESP doubles the ops surface (DNS, monitoring, billing, two webhook integrations). Only worth it if Resend's parsing was inadequate — and the spike showed it wasn't.

### AWS SES (S3 + SNS for inbound)

Cheapest at scale, but heavier setup (SES inbound rules → S3 → SNS → Lambda or webhook), no parsed JSON without DIY MIME parsing, and no DX wins over Resend at our volume.

### Per-workspace address with agent attribution from body

Considered earlier — would have required parsing the listing-agent name from REA's `Hi <Name>,` greeting and fuzzy-matching it against agents in the workspace. Rejected because (a) name matching is unreliable across spelling variants and (b) per-agent addresses cost the same schema-wise.

### Adding `'portal'` to the existing `crm_source` enum

Considered as a smaller migration than the `(source, medium)` rename. Rejected because the conflation of "kind of capture surface" with "specific provider" was the root issue — adding more values to the enum extends the conflation rather than resolving it.

## Open questions / future work

* **Domain.com.au parser** — deferred until Matt's first Domain enquiry lands. Architecture is the same; only the parser body differs. Will be tracked as a follow-up issue.
* **Auto-responder** — sending the enquirer a templated "Thanks, Matt will be in touch" the moment the enquiry lands. v2 work; deliberately out of scope for v1 capture.
* **Listings as a first-class table** — currently listing details are denormalised onto each enquiry (`listing_external_id`, `listing_address`, `listing_url`). Promote to a `listings` table when cross-listing reporting earns it.
* **Settings UI for agents** — a Horace settings page that surfaces the agent's portal address (with copy button) and lets them rotate it. Currently the address is generated and inserted via SQL; no UI.
* **Rate / spam handling** — Resend handles standard spam at ingest; if we see junk arriving from non-portal senders later, we'll add a filter step before parser dispatch.
* **Migration version conflicts** — separate cleanup work tracked in [HOR-62](https://linear.app/gohorace/issue/HOR-62) to disentangle the colliding date-prefix migrations created during HOR-63 development.

## References

* HOR-28 spike samples and scoring (Linear comments)
* [Resend Received Emails API](https://resend.com/docs/api-reference/emails/retrieve-received-email)
* [Resend webhook verification (svix)](https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests)
