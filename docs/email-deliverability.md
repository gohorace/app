# Email deliverability — Resend / gohorace.com

Outbound email from Horace (daily briefings, weekly briefings, alert emails) all sends through Resend from `briefing@gohorace.com` and related addresses on the same domain. This doc is the checklist when "the email isn't arriving" — which on 2026-05-14 turned out to mean "it's arriving in spam," not "it never fired."

Before chasing scheduling / cron bugs, **always check spam first** and verify a row exists in `notification_log` with `type = 'email_daily_brief'` (or whichever type you're investigating). If the row exists, the send happened — the problem is delivery, not scheduling.

## Verifying a send actually happened

```sql
-- Did the cron fire today and write a log row for me?
SELECT s.agent_id, nl.sent_at
FROM agents a
JOIN agent_settings s ON s.agent_id = a.id
LEFT JOIN notification_log nl
  ON nl.agent_id = a.id
  AND nl.type = 'email_daily_brief'
  AND nl.sent_at >= now() - interval '24 hours'
WHERE a.email = 'YOUR_EMAIL';
```

Row + `sent_at` → it sent; problem is deliverability (this doc). No row → it didn't send; problem is cron / settings / env (see [daily-briefing/route.ts](../apps/web/src/app/api/cron/daily-briefing/route.ts) and verify `CRON_SECRET`, `RESEND_API_KEY`, and that the agent's `agent_settings` row has `briefing_emails` non-empty OR `agent_email` set).

## Deliverability checklist (in priority order)

Hit 1–3 first; they're usually 80% of the fix.

### 1. DNS auth on gohorace.com

In Resend → Domains → `gohorace.com`, every record must show **Verified**:

- **SPF** — TXT, typically `v=spf1 include:_spf.resend.com ~all` (use the exact line Resend generates)
- **DKIM** — CNAMEs Resend generates (`resend._domainkey`, etc.)
- **DMARC** — TXT on `_dmarc.gohorace.com`, minimum `v=DMARC1; p=none; rua=mailto:dmarc@gohorace.com`

A single pending record drops the message a tier with Gmail/Microsoft — straight to spam.

### 2. List-Unsubscribe headers

Gmail and Yahoo require these on bulk mail since Feb 2024. Without them you skip to the Promotions tab at best, spam at worst.

Add to every `resend.emails.send` call in the briefing routes:

```ts
headers: {
  'List-Unsubscribe': `<${appUrl}/settings/notifications>, <mailto:unsubscribe@gohorace.com>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
},
```

Lives in:
- [daily-briefing/route.ts](../apps/web/src/app/api/cron/daily-briefing/route.ts)
- [weekly-briefing/route.ts](../apps/web/src/app/api/cron/weekly-briefing/route.ts)

The unsubscribe URL must accept a `POST` for One-Click. If `/settings/notifications` doesn't, point at a dedicated unsubscribe endpoint.

### 3. Plain-text alternative

We only send `html`. Resend supports `text` — adding even a stripped version drops the spam score:

```ts
await resend.emails.send({ ..., html, text: plainTextVersion })
```

Generate `text` from the briefing data, not from the HTML — HTML-to-text conversions look mechanical and don't help.

### 4. Sender warm-up

New domains get throttled. Briefing-only volume from a cold `gohorace.com` looks bot-like. Sending invites, password resets, magic links from the same domain builds reputation faster than briefs alone.

### 5. Per-recipient inbox rescue (immediate, one-off)

For your own / a customer's account:
- Gmail: open spam'd brief → **Report not spam** → **Add briefing@gohorace.com to contacts**.
- This fixes only that recipient. It does not fix the underlying reputation issue.

## Related

- **Duplicate sends.** Briefs sometimes send twice when the cron function times out and Vercel retries. Tracked separately — see the `notification_log` for `sent_at` rows clustered minutes apart against the same `agent_id`. Adding an idempotency guard inside the per-agent loop is the fix; see the cron route.
- **Inbound email infra** — separate concern, see [adr/0001-inbound-email-infrastructure.md](adr/0001-inbound-email-infrastructure.md).
