-- ============================================================
-- SECURITY: full SECURITY DEFINER grant classification (2026-05-28)
--
-- Companion to 20260528000002 (which locks the critical 10). This
-- migration classifies EVERY remaining flagged function (linter lints
-- 0028/0029 anon/authenticated-executable, and 0011 search_path) from a
-- live audit of pg_proc on prod. See docs/lint-remediation-2026-05-28.md.
--
-- Buckets:
--   A. Lock to service_role — DEFINER RPCs called only via the admin
--      (service-role) client server-side. Confirmed against app call sites.
--   B. Revoke from PUBLIC — DEFINER trigger functions (run as table owner;
--      never invoked via /rest/v1/rpc, so no grantee needs EXECUTE).
--   C. Pin search_path — SECURITY INVOKER functions flagged by 0011.
--
-- NOT touched (intentionally public; would break things if locked):
--   • user_workspace_ids(), user_agent_ids() — used in 79 RLS policy
--     clauses; revoking authenticated EXECUTE breaks every RLS query.
--   • search_localities(text,integer) — public G-NAF reference data.
-- These remain as accepted 0028/0029 warnings.
--
-- Idempotent. REVOKE is a no-op when the grant is already absent.
-- ============================================================

-- ─── A. Lock DEFINER RPCs to service_role ───────────────────────────
REVOKE EXECUTE ON FUNCTION public.click_short_link(text)                                                                           FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.click_short_link(text)                                                                           TO service_role;
REVOKE EXECUTE ON FUNCTION public.create_workspace_with_agent(uuid, text, text, text, text, text, text)                            FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_workspace_with_agent(uuid, text, text, text, text, text, text)                            TO service_role;
REVOKE EXECUTE ON FUNCTION public.emit_email_event(uuid, text, jsonb)                                                              FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.emit_email_event(uuid, text, jsonb)                                                              TO service_role;
REVOKE EXECUTE ON FUNCTION public.expire_old_map_summary_cache()                                                                   FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.expire_old_map_summary_cache()                                                                   TO service_role;
REVOKE EXECUTE ON FUNCTION public.generate_campaign_tokens(uuid, uuid, uuid[])                                                     FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.generate_campaign_tokens(uuid, uuid, uuid[])                                                     TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_contact_events(uuid)                                                                         FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_contact_events(uuid)                                                                         TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_contacts_list(uuid)                                                                          FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_contacts_list(uuid)                                                                          TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_daily_briefing_inspections(uuid, timestamptz)                                                FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_daily_briefing_inspections(uuid, timestamptz)                                                TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_map_heat_cells(uuid, text)                                                                   FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_map_heat_cells(uuid, text)                                                                   TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_property_signals(uuid, uuid, text)                                                           FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_property_signals(uuid, uuid, text)                                                           TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_suburb_signals(uuid, uuid, text)                                                            FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_suburb_signals(uuid, uuid, text)                                                            TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_weekly_briefing_data(uuid)                                                                   FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_weekly_briefing_data(uuid)                                                                   TO service_role;
REVOKE EXECUTE ON FUNCTION public.is_recipient_excluded(uuid, text)                                                                FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.is_recipient_excluded(uuid, text)                                                                TO service_role;
REVOKE EXECUTE ON FUNCTION public.onboarding_contacts_in_patch(uuid)                                                               FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.onboarding_contacts_in_patch(uuid)                                                               TO service_role;
REVOKE EXECUTE ON FUNCTION public.resolve_campaign_token(uuid, uuid, text, text)                                                   FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.resolve_campaign_token(uuid, uuid, text, text)                                                   TO service_role;
REVOKE EXECUTE ON FUNCTION public.resolve_contact_link_click(text)                                                                 FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.resolve_contact_link_click(text)                                                                 TO service_role;
REVOKE EXECUTE ON FUNCTION public.resolve_residence_property(uuid, text, text, text, text, text, text, text, numeric, numeric)     FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.resolve_residence_property(uuid, text, text, text, text, text, text, text, numeric, numeric)     TO service_role;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()                                                                                FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rls_auto_enable()                                                                                TO service_role;
REVOKE EXECUTE ON FUNCTION public.stitch_contact_core(uuid, uuid, text, text, text, uuid, text, text, text, text, jsonb)           FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.stitch_contact_core(uuid, uuid, text, text, text, uuid, text, text, text, text, jsonb)           TO service_role;
REVOKE EXECUTE ON FUNCTION public.stitch_contact_from_embed(uuid, text, text, text, uuid, text, text)                              FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.stitch_contact_from_embed(uuid, text, text, text, uuid, text, text)                              TO service_role;
REVOKE EXECUTE ON FUNCTION public.stitch_contact_from_inspection(text, text, text, text, uuid, text)                               FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.stitch_contact_from_inspection(text, text, text, text, uuid, text)                               TO service_role;
REVOKE EXECUTE ON FUNCTION public.stitch_contact_from_token(text, uuid, text)                                                      FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.stitch_contact_from_token(text, uuid, text)                                                      TO service_role;
REVOKE EXECUTE ON FUNCTION public.stitch_contact_from_token(text, uuid, text, text)                                                FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.stitch_contact_from_token(text, uuid, text, text)                                                TO service_role;

-- ─── B. Revoke DEFINER trigger functions from PUBLIC ────────────────
-- Triggers execute as the table owner regardless of grant; no role needs
-- EXECUTE, so removing the PUBLIC default closes the 0028/0029 flag safely.
REVOKE EXECUTE ON FUNCTION public.seed_default_email_exclusions()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_contact_suburb()                        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_contact_workspace_id()                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_contacts_suburb_on_property_change()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_ensure_contact_tracked_link()            FROM PUBLIC, anon, authenticated;

-- ─── C. Pin search_path on SECURITY INVOKER functions (lint 0011) ───
-- None reference gnaf/vault, so `public` is the correct (and minimal) pin.
ALTER FUNCTION public.agents_create_inbound_address()                                          SET search_path = public;
ALTER FUNCTION public.backfill_events_contact_id()                                             SET search_path = public;
ALTER FUNCTION public.compute_address_hash(text, text, text, text, text, text)                 SET search_path = public;
ALTER FUNCTION public.generate_inbound_local_part()                                            SET search_path = public;
ALTER FUNCTION public.generate_tracked_link_token()                                            SET search_path = public;
ALTER FUNCTION public.get_daily_briefing_data(uuid)                                            SET search_path = public;
ALTER FUNCTION public.normalize_address_part(text)                                             SET search_path = public;
ALTER FUNCTION public.set_notification_log_workspace_id()                                       SET search_path = public;
ALTER FUNCTION public.set_updated_at()                                                         SET search_path = public;
ALTER FUNCTION public.summarize_user_agent(text)                                               SET search_path = public;
ALTER FUNCTION public.update_contact_last_seen()                                               SET search_path = public;
