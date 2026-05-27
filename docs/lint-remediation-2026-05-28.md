# Supabase linter remediation — 2026-05-28

Handoff for the post-restart session (Supabase MCP now connected). Goal: clear the
Supabase database-linter findings. **Follow the manual-apply pattern** (execute_sql
for DDL **+** manual `INSERT INTO supabase_migrations.schema_migrations`), NOT
`apply_migration`/db push — see the migration-drift memory (duplicate-timestamp legacy,
HOR-131). Use MCP `execute_sql` to query prod grants live and to verify after applying.

## Status

| Migration | What | Status |
|---|---|---|
| `20260528000001_lint_security_fixes.sql` | gnaf RLS-enable (localities, address_principal) + `inbound_emails_unresolved` → `security_invoker` | **APPLIED** to prod 2026-05-28 (schema_migrations row confirmed) |
| `20260528000002_lockdown_definer_rpc_execute.sql` | Lock the critical 10 DEFINER RPCs to `service_role` (vault secrets, OAuth/token, invite, core-market) | **APPLIED** 2026-05-28 via MCP (was never applied before; anon EXECUTE confirmed open then closed) |
| `20260528000003_classify_definer_rpc_grants.sql` | Full classification: lock 23 server RPCs, revoke 5 triggers from PUBLIC, pin search_path ×11 | **APPLIED** 2026-05-28 via MCP; verified |

**Final advisor state:** ~80 DEFINER-execute + 11 search_path warnings cleared. Remaining = accept-list only:
0028/0029 ×3 (search_localities, user_agent_ids, user_workspace_ids — public by design), extension_in_public (pg_trgm), public_bucket_allows_listing (avatars), auth_leaked_password_protection (enable in Auth settings). Plus 7 `rls_enabled_no_policy` **INFO** (gnaf ×2 from …001's deny-all RLS; oauth_clients, oauth_authorization_codes, pairing_tokens, push_subscriptions, map_summary_cache — service-role-only, deny-all intended).

The 3 original ERRORs (security_definer_view, rls_disabled_in_public ×2) are fixed by `…001`.

## Root cause (recurring)
Same migration drift as elsewhere: REVOKE/GRANT statements in source migrations never
landed on prod, so functions intended to be `service_role`-only are live-executable by
`anon`/`authenticated`. The linter (`has_function_privilege` live) is ground truth.

## Classification — every flagged DEFINER function

### 🔒 Lock to service_role  (`REVOKE EXECUTE … FROM PUBLIC, anon, authenticated; GRANT … TO service_role;`)
Confirmed called only via the `admin` (service-role) client; nothing public depends on them.
- get_contact_events, get_contacts_list, get_daily_briefing_data, get_daily_briefing_inspections,
  get_weekly_briefing_data, get_property_signals, get_suburb_signals, get_map_heat_cells,
  onboarding_contacts_in_patch, create_workspace_with_agent, resolve_contact_link_click,
  click_short_link, resolve_residence_property, emit_email_event, is_recipient_excluded,
  stitch_contact_from_token (BOTH sigs), stitch_contact_from_embed, stitch_contact_from_inspection,
  stitch_contact_core (internal-only).
- **resolve_campaign_token, generate_campaign_tokens** — no caller found in apps/; **Andy's decision: lock to service_role** anyway (revisit if tracked-email campaign paths call them with anon).

### 🔻 Revoke from PUBLIC  (triggers/helpers; not REST-callable, triggers run as table owner so this is safe)
set_updated_at, set_notification_log_workspace_id, update_contact_last_seen, sync_contact_suburb,
sync_contact_workspace_id, sync_contacts_suburb_on_property_change, trg_ensure_contact_tracked_link,
agents_create_inbound_address, seed_default_email_exclusions, rls_auto_enable, compute_address_hash,
normalize_address_part, generate_inbound_local_part, generate_tracked_link_token, summarize_user_agent,
backfill_events_contact_id.

### ✅ Keep public — DO NOT lock (accept the 0028/0029 warning)
- **user_workspace_ids, user_agent_ids** — used in **79** RLS policy clauses; revoking `authenticated`
  EXECUTE breaks every RLS-protected query. Return only the caller's own membership → harmless.
- **search_localities** — public G-NAF reference data; migration explicitly grants `anon`.

### 📋 search_path pin (lint 0011) — `ALTER FUNCTION … SET search_path = public`
set_updated_at, set_notification_log_workspace_id, generate_inbound_local_part, generate_tracked_link_token,
compute_address_hash, agents_create_inbound_address, update_contact_last_seen, get_daily_briefing_data,
backfill_events_contact_id, summarize_user_agent, normalize_address_part.
(None touch gnaf/vault → `public` is correct. Get exact signatures via pg_proc.)

### 🟡 Accept / config (not a code migration)
- extension_in_public (pg_trgm, pgcrypto) — moving extensions post-hoc is risky; accept.
- public_bucket_allows_listing (`avatars`) — tighten the `avatars_public_read` SELECT policy separately if desired.
- auth_leaked_password_protection — enable in Auth settings (HaveIBeenPwned toggle).

## Suggested execution (post-restart, with MCP)
1. `execute_sql`: grant audit on the critical 10 + the lock-set (has_function_privilege for anon/authenticated/service_role). Confirm before-state.
2. Apply `…002` if anon still has EXECUTE on the critical 10; record its schema_migrations row.
3. Build `…003` from the buckets above (introspect exact signatures from pg_proc). Apply DDL via execute_sql + manual schema_migrations INSERT.
4. Re-run the linter / re-audit grants. Expect only the accept-list (user_workspace_ids, user_agent_ids, search_localities) + the 🟡 config items to remain.
