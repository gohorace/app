# Alerts & Notifications Audit

Status: discovery deliverable for the Alerts & Notifications Linear project ([HOR-67](https://linear.app/gohorace/issue/HOR-67)).
Date of audit: 2026-05-12.
Scope: every alert, nudge, and notification Horace currently sends across push, email, and SMS.

This document is the input to the implementation pass: kill what shouldn't exist, rewrite what does, build what's missing. The designed alert set lives in the per-alert issues on the Linear project.

---

## 1. Current alerts inventory

| # | Alert | Trigger | Channel | Recipient | Frequency / dedup | Source file |
| - | - | - | - | - | - | - |
| 1 | Auth magic link (signup, magiclink, recovery, email_change, invite, reauthentication) | Supabase auth webhook | Email (Resend) | User email | Per event | `apps/web/src/app/api/auth/send-email/route.ts` |
| 2 | Daily briefing | Vercel cron `0 7 * * *`, filtered by agent timezone + `daily_briefing_hour` | Email (Resend) | `briefing_emails[]` with fallback to `agent_email` | Daily | `apps/web/src/app/api/cron/daily-briefing/route.ts` |
| 3 | Weekly briefing | Endpoint exists, **not scheduled** in `apps/web/vercel.json` | Email (Resend) | `agent_email` (legacy field only) | Would be weekly | `apps/web/src/app/api/cron/weekly-briefing/route.ts` |
| 4 | Onboarding email developer helper | Manual POST from onboarding modal ([HOR-52](https://linear.app/gohorace/issue/HOR-52)) | Email (Resend) | Developer (user-supplied address) | On request | `apps/web/src/app/api/onboarding/email-developer/route.ts` |
| 5 | `alert_score_threshold` | Contact score crosses agent threshold | Push **+** Email | Owner agent | 30-min dedup via `notification_log` | `apps/web/src/lib/notifications/push.ts` |
| 6 | `alert_form_submit` | Identified contact submits a tracked form | Push **+** Email | Owner agent | 30-min dedup | `apps/web/src/lib/notifications/push.ts` |
| 7 | `alert_return_visit` | Contact returns (score-gated when `push_alert_mode = 'all'`) | Push **+** Email | Owner agent | 30-min dedup | `apps/web/src/lib/notifications/push.ts` |
| 8 | SMS: threshold / form submit / return visit | Same triggers as alerts 5–7 | SMS (Twilio) | `agent_phone` | 24h dedup | `apps/web/src/lib/notifications/sms.ts` — **dormant, no UI surface** |

### Per-alert detail (full audit template)

The brief's audit template is: alert name, trigger, channel, recipient, frequency, current copy, subject line, sign-off, sender identity, opt-out, last reviewed.

#### 1. Auth magic link

* **Trigger:** Supabase auth webhook (`signup`, `magiclink`, `recovery`, `email_change`, `invite`, `reauthentication`).
* **Channel:** Email.
* **Recipient:** user's email address.
* **Frequency:** per event.
* **Current copy:** branded HTML with action button per template type.
* **Subject line:** template-specific.
* **Sign-off:** none explicit; sender identity carries it.
* **Sender identity:** `Horace <auth@gohorace.com>` (first-person Horace — **violates principle**: operational emails should sign as the team).
* **Opt-out:** none (transactional, correctly not opt-outable).
* **Last reviewed:** untouched since [HOR-29](https://linear.app/gohorace/issue/HOR-29) auth work landed.

#### 2. Daily briefing

* **Trigger:** Vercel cron at `0 7 * * *` UTC; filtered to agents whose local time matches `daily_briefing_hour`.
* **Channel:** Email.
* **Recipient:** `briefing_emails[]` with fallback to `agent_email`.
* **Frequency:** daily.
* **Current copy:** templated summary of yesterday's activity.
* **Subject line:** "Your morning briefing".
* **Sign-off:** *Seize the moment — Horace*.
* **Sender identity:** Horace, first-person.
* **Opt-out:** per-agent `daily_briefing_enabled` toggle in settings.
* **Last reviewed:** recently maintained as the briefings pattern was finalised.
* **Logged as:** `'email_daily_brief'` in `notification_log`.

#### 3. Weekly briefing

* **Trigger:** none currently — endpoint exists but is **not registered in `apps/web/vercel.json`**.
* **Channel:** Email.
* **Recipient:** `agent_email` only (does not honour `briefing_emails[]` — divergence from daily briefing).
* **Frequency:** would be weekly, gated by `weekly_briefing_day`.
* **Sign-off:** *Seize the moment — Horace*.
* **Sender identity:** Horace, first-person.
* **Logged as:** `'email_briefing'` — inconsistent with daily's `'email_daily_brief'`.
* **Opt-out:** per-agent `weekly_briefing_enabled` toggle.
* **Status:** dead code in its current form. Rewrite as `weekly_patch_digest` per [HOR-88](https://linear.app/gohorace/issue/HOR-88).

#### 4. Onboarding email developer helper

* **Trigger:** manual POST from onboarding modal when an agent asks their developer to install the script.
* **Channel:** Email.
* **Recipient:** developer's email (user-supplied).
* **Sign-off:** *— The Horace team*.
* **Sender identity:** the Horace team (transactional, correct).
* **Opt-out:** not applicable.

#### 5–7. Score-based push/email alerts

These three alerts share a pattern and the same principles violations.

| Field | `alert_score_threshold` | `alert_form_submit` | `alert_return_visit` |
| - | - | - | - |
| Trigger | Contact score crosses `alert_threshold` | Identified contact submits a tracked form | Contact returns; score-gated when `push_alert_mode = 'all'` |
| Channel | Push + Email | Push + Email | Push + Email |
| Recipient | Owner agent | Owner agent | Owner agent |
| Frequency | 30-min dedup per (agent, contact, type) | 30-min dedup | 30-min dedup |
| Current push copy | *"Something's stirring." / "[Contact] reached your threshold."* | *"[Contact] raised their hand."* | *"[Contact] is back on your site."* |
| Email subject | Same as push title | Same | Same |
| Sign-off | None (push), none (email) | None | None |
| Sender identity | System-toned, not Horace voiced | System-toned | System-toned |
| Opt-out | Mode-based only (`threshold | all | hourly_digest`) — no granular toggle | Same | Same |
| Last reviewed | Pre-brief; copy hasn't been touched recently | Same | Same |

#### 8. SMS variants (dormant)

* **Trigger:** same conditions as alerts 5–7.
* **Channel:** SMS (Twilio).
* **Recipient:** `agent_phone`.
* **Frequency:** 24h dedup.
* **Sender identity:** plain SMS, no sender name.
* **Opt-out:** would honour `sms_enabled` setting — but the setting is not exposed in any UI.
* **Status:** code complete (`sendSmsIfThresholdCrossed`, `sendFormSubmitSms`, `sendReturnVisitSms` exported from `apps/web/src/lib/notifications/sms.ts`) and never invoked from the runtime path. **Dormant by design — out of scope for V1 per project brief.**

---

## 2. Flagged list — current alerts violating principles

| Alert(s) | Violation | Severity | Resolution issue |
| - | - | - | - |
| `alert_score_threshold`, `alert_form_submit`, `alert_return_visit` | Push + email double-send for the same trigger. Brief: *"never send the same content to both channels"*. | High | [HOR-74](https://linear.app/gohorace/issue/HOR-74) |
| `alert_score_threshold`, `alert_form_submit`, `alert_return_visit` | SaaS-toned copy ("Something's stirring", "raised their hand"). Not first-person Horace, no context, no property name. | High | [HOR-73](https://linear.app/gohorace/issue/HOR-73) |
| Auth magic link emails | Signed as Horace in first person. Brief: *"operational emails are the only alerts that don't speak as Horace"*. | Medium | [HOR-93](https://linear.app/gohorace/issue/HOR-93) |
| All push alerts | Mode-based opt-out (`threshold | all | hourly_digest`) — no per-alert toggle. Brief: *"granular control, no bundles"*. | High | [HOR-75](https://linear.app/gohorace/issue/HOR-75) |
| `push_alert_mode = 'hourly_digest'` | Option is selectable but no cron implements it; choosing it silently disables real-time push. | Medium | [HOR-95](https://linear.app/gohorace/issue/HOR-95) |
| Weekly briefing endpoint | Built, not scheduled in `apps/web/vercel.json`. Uses legacy `agent_email` not `briefing_emails[]`. Logs as `'email_briefing'` — inconsistent with daily. Dead code. | Medium | [HOR-88](https://linear.app/gohorace/issue/HOR-88) |
| All push alerts | No working-hours gating — fires regardless of agent's local time. | High | [HOR-76](https://linear.app/gohorace/issue/HOR-76) |
| All alerts | No workspace-level quiet mode. | Medium | [HOR-76](https://linear.app/gohorace/issue/HOR-76) |
| All alerts | No in-app activity feed. Only `notification_log` (audit/dedup), not user-visible. | Medium | [HOR-77](https://linear.app/gohorace/issue/HOR-77) |
| Daily/weekly briefing emails | No unsubscribe link — only "Manage preferences" which requires login. CAN-SPAM / GDPR risk. | Medium | Roll into [HOR-88](https://linear.app/gohorace/issue/HOR-88) rewrite. |

---

## 3. Gap analysis — designed alerts not yet built

| Category | Alert | Linear issue |
| - | - | - |
| Lead capture | `portal_enquiry_received` | [HOR-78](https://linear.app/gohorace/issue/HOR-78) |
| Lead capture | `form_submission_received` (semantic rewrite) | [HOR-79](https://linear.app/gohorace/issue/HOR-79) |
| Lead capture | `csv_import_complete` | [HOR-80](https://linear.app/gohorace/issue/HOR-80) |
| High-intent | `appraisal_page_visit` | [HOR-81](https://linear.app/gohorace/issue/HOR-81) |
| High-intent | `high_frequency_visits` | [HOR-82](https://linear.app/gohorace/issue/HOR-82) |
| High-intent | `repeat_listing_views` | [HOR-83](https://linear.app/gohorace/issue/HOR-83) |
| High-intent | `sold_results_browsing_in_own_suburb` | [HOR-84](https://linear.app/gohorace/issue/HOR-84) |
| High-intent | `contact_page_visit_no_action` | [HOR-85](https://linear.app/gohorace/issue/HOR-85) |
| Re-engagement | `dormant_contact_returns` | [HOR-86](https://linear.app/gohorace/issue/HOR-86) |
| Re-engagement | `appraised_property_owner_returns` | [HOR-87](https://linear.app/gohorace/issue/HOR-87) |
| Patch | `weekly_patch_digest` (rewrite of weekly briefing) | [HOR-88](https://linear.app/gohorace/issue/HOR-88) |
| Patch | `patch_activity_spike` | [HOR-89](https://linear.app/gohorace/issue/HOR-89) |
| Role transition | `buyer_also_becomes_seller` | [HOR-90](https://linear.app/gohorace/issue/HOR-90) |
| Role transition (V1.5) | `inferred_role_needs_confirmation` | [HOR-91](https://linear.app/gohorace/issue/HOR-91) |
| Quiet-period | `quiet_period_reassurance` | [HOR-92](https://linear.app/gohorace/issue/HOR-92) |
| Operational | `agent_departed`, `export_ready` | [HOR-94](https://linear.app/gohorace/issue/HOR-94) |

---

## 4. Deprecation list

| Alert / surface | Action | Issue |
| - | - | - |
| `alert_score_threshold` | Replace with `appraisal_page_visit`, `high_frequency_visits`, `sold_results_browsing_in_own_suburb`. Kill after replacements ship. | [HOR-96](https://linear.app/gohorace/issue/HOR-96) |
| `alert_form_submit` | Split into `portal_enquiry_received` + `form_submission_received` (by source). Kill after replacements ship. | [HOR-96](https://linear.app/gohorace/issue/HOR-96) |
| `alert_return_visit` | Split into `dormant_contact_returns`, `appraised_property_owner_returns`, `contact_page_visit_no_action`. Kill after replacements ship. | [HOR-96](https://linear.app/gohorace/issue/HOR-96) |
| `push_alert_mode = 'hourly_digest'` | Remove from settings UI. No path to ship. | [HOR-95](https://linear.app/gohorace/issue/HOR-95) |
| Weekly briefing endpoint as written | Rewrite as `weekly_patch_digest` against `briefing_emails[]`, register cron, harmonise log type to `'email_weekly_digest'`. | [HOR-88](https://linear.app/gohorace/issue/HOR-88) |

---

## 5. Copy diff — current vs designed

Each row links to the per-alert issue containing the verbatim designed copy. Anything not on this list either doesn't exist yet (see gap analysis) or doesn't need a rewrite.

| Current alert | Current copy (paraphrased) | Designed alert(s) | Issue |
| - | - | - | - |
| `alert_score_threshold` (high-intent score crossing) | *"Something's stirring. [Contact] reached your threshold."* | `appraisal_page_visit` → *"Sarah just looked at your appraisal page. She didn't fill the form — but she was there. Worth a call."* | [HOR-81](https://linear.app/gohorace/issue/HOR-81) |
| `alert_score_threshold` (frequent return) | Same generic copy | `high_frequency_visits` → *"Sarah's been back three times this week. Something's changed."* | [HOR-82](https://linear.app/gohorace/issue/HOR-82) |
| `alert_score_threshold` (sold-results browsing) | Same generic copy | `sold_results_browsing_in_own_suburb` → *"Sarah's looking at recent sales in her own suburb. She might be thinking about selling."* | [HOR-84](https://linear.app/gohorace/issue/HOR-84) |
| `alert_form_submit` (portal-sourced) | *"[Contact] raised their hand."* | `portal_enquiry_received` → *"Sarah Chen just enquired on 12 Maple St via REA. Horace has set her up — first reply via Horace and he'll start watching her properly."* | [HOR-78](https://linear.app/gohorace/issue/HOR-78) |
| `alert_form_submit` (web form) | Same generic copy | `form_submission_received` (with 3 variants: appraisal / listing enquiry / generic) | [HOR-79](https://linear.app/gohorace/issue/HOR-79) |
| `alert_return_visit` (dormant) | *"[Contact] is back on your site."* | `dormant_contact_returns` → *"Sarah's back. She's been quiet for four months and just spent 12 minutes on listings. Worth a quick hello."* | [HOR-86](https://linear.app/gohorace/issue/HOR-86) |
| `alert_return_visit` (appraised owner) | Same generic copy | `appraised_property_owner_returns` → *"You appraised 14 Maple St for Sarah 18 months ago. She's back on your site this week."* | [HOR-87](https://linear.app/gohorace/issue/HOR-87) |
| `alert_return_visit` (contact-page bounce) | Same generic copy | `contact_page_visit_no_action` → *"Sarah was on your contact page. Didn't get in touch. Worth reaching out first."* | [HOR-85](https://linear.app/gohorace/issue/HOR-85) |
| Auth magic link emails | Signed *Horace* in first person | Same content, signed *— The Horace team* | [HOR-93](https://linear.app/gohorace/issue/HOR-93) |
| Weekly briefing | Long body, generic patch summary, *Seize the moment — Horace* sign-off | `weekly_patch_digest` (full structure in issue) + `quiet_period_reassurance` empty-state fork | [HOR-88](https://linear.app/gohorace/issue/HOR-88), [HOR-92](https://linear.app/gohorace/issue/HOR-92) |

---

## 6. Out of scope (V1)

* SMS as a channel — code is dormant, no UI. Deferred to V2.
* Slack / Teams integrations. V2.
* Per-contact alert customisation. V2.
* Manager rollup alerts. V1.5.
* Predictive alerts ("Sarah is likely to list within 90 days"). V2+, needs more data.
* Localisation — see [HOR-70](https://linear.app/gohorace/issue/HOR-70).

---

## 7. Sequencing

The implementation order, mirroring the Linear project's priority ladder:

1. Resolve the five Open Questions ([HOR-68](https://linear.app/gohorace/issue/HOR-68)–[HOR-72](https://linear.app/gohorace/issue/HOR-72)).
2. Cross-cutting infra (Urgent): voice & copy refactor ([HOR-73](https://linear.app/gohorace/issue/HOR-73)), channel dedupe ([HOR-74](https://linear.app/gohorace/issue/HOR-74)).
3. Cross-cutting infra (High): per-alert opt-out ([HOR-75](https://linear.app/gohorace/issue/HOR-75)), working hours + quiet mode ([HOR-76](https://linear.app/gohorace/issue/HOR-76)), in-app activity feed ([HOR-77](https://linear.app/gohorace/issue/HOR-77)).
4. Lead-capture alerts (High): [HOR-78](https://linear.app/gohorace/issue/HOR-78), [HOR-79](https://linear.app/gohorace/issue/HOR-79).
5. High-intent alerts + score-triad deprecation: [HOR-81](https://linear.app/gohorace/issue/HOR-81)–[HOR-85](https://linear.app/gohorace/issue/HOR-85), then [HOR-96](https://linear.app/gohorace/issue/HOR-96).
6. Weekly patch digest + quiet-period reassurance: [HOR-88](https://linear.app/gohorace/issue/HOR-88), [HOR-92](https://linear.app/gohorace/issue/HOR-92).
7. Re-engagement, role transitions, patch spike: [HOR-86](https://linear.app/gohorace/issue/HOR-86), [HOR-87](https://linear.app/gohorace/issue/HOR-87), [HOR-89](https://linear.app/gohorace/issue/HOR-89), [HOR-90](https://linear.app/gohorace/issue/HOR-90).
8. Operational voice split + `agent_departed`/`export_ready`: [HOR-93](https://linear.app/gohorace/issue/HOR-93), [HOR-94](https://linear.app/gohorace/issue/HOR-94).
9. Cleanup: [HOR-95](https://linear.app/gohorace/issue/HOR-95) (`hourly_digest`), [HOR-96](https://linear.app/gohorace/issue/HOR-96) (score triad).
10. [HOR-91](https://linear.app/gohorace/issue/HOR-91) `inferred_role_needs_confirmation` lands in V1.5 once inference confidence is in place.
