# Mobile pair — QA playbook

Durable manual test plan for HOR-56 ("Take Horace with you"). Run end-to-end before each release that touches any of the HOR-56.* surfaces, and after each significant Twilio / Supabase / push provider change.

The plan ships in `/docs/pairing-qa.md` rather than as a Linear comment because the surface depends on real devices and external providers (Twilio, push, Safari, Chrome) that no automated test can fully cover. The doc is the running record of what we tested and what we know is degraded.

---

## Hardware needed

Before starting:

- 1 × iOS handset (real device — Simulator behaves differently on install and standalone)
- 1 × Android handset with Chrome (real device — Chromium-on-desktop installs differ)
- 1 × macOS desktop browser (Chrome or Safari) signed in to the agent under test
- A real AU mobile number reachable by Twilio in the target environment
- Access to the SQL editor for the target Supabase project (to inspect `pairing_tokens` and `push_subscriptions`)

---

## Pre-flight

- [ ] `_migrations` shows `20260516000001` applied. If missing, apply the migration file and INSERT the tracking row before continuing (the file is committed under `supabase/migrations/`).
- [ ] The agent under test has `last_completed_step IN ('notify', NULL)` — i.e. ready to land on the pair step. Roll back to `'notify'` via `UPDATE agents SET last_completed_step='notify' WHERE id=…` if needed.
- [ ] No stale `pairing_tokens` rows for this agent: `DELETE FROM pairing_tokens WHERE agent_id=…` to start clean.
- [ ] No paired phones already registered for this agent: `SELECT count(*) FROM push_subscriptions WHERE agent_id=… AND device_kind='mobile'` should match what you expect.

---

## Acceptance criteria (from the handoff spec)

The feature ships when all seven pass on at least one real iOS handset and one real Android handset.

- [ ] **AC1** — Scan QR with phone camera → install page on phone → auto-authenticated as the agent (no extra login step).
- [ ] **AC2** — Enter AU mobile + "Text me the link" → SMS arrives within 10s with the same install URL.
- [ ] **AC3** — iOS Safari: Share → Add to Home Screen → home-screen launch → push permission prompt fires from the standalone PWA.
- [ ] **AC4** — Android Chrome: native install prompt → after install, push permission prompt.
- [ ] **AC5** — Push subscription registered → desktop "Paired" pill appears within 3s (we poll every 2s).
- [ ] **AC6** — Test push from the paired-state button lands on the paired device.
- [ ] **AC7** — Install link expires after 15 min AND after the first successful pairing (re-scan shows "Already paired" copy).

---

## Test cases

Each case lists steps and what to verify. Tick the cases that pass; note observations on the ones that don't.

### 1. Happy path — Android Chrome

- [ ] Start in onboarding on the pair step. QR appears within ~1s.
- [ ] Scan QR with Android Chrome on the phone. Page loads `/m/<token>` then redirects to `/auth/callback` → `/m/<token>/install`.
- [ ] Install banner offers "Install Horace". Tap install; the dialog appears and accept.
- [ ] After install: push permission prompt appears. Tap "Allow notifications". System dialog accepts.
- [ ] Desktop flips to "Paired. Push is live on your Android phone." within 2s.
- [ ] In Supabase: `pairing_tokens` row has `consumed_at` set and `consumed_outcome='push_granted'`. `push_subscriptions` has a new row with `device_kind='mobile'`.

### 2. Happy path — iOS Safari

- [ ] Start in onboarding on the pair step.
- [ ] Scan QR with iOS Safari. Page loads through magic-link redirect and lands at the install page.
- [ ] Three-step Add-to-Home-Screen guide renders correctly. Follow Share → Add to Home Screen.
- [ ] Open Horace from the home screen icon — PWA launches at `/dashboard`.
- [ ] Pairing overlay appears on the dashboard within 1–2s, asking for push permission.
- [ ] Tap "Allow notifications". System dialog accepts.
- [ ] Desktop flips to "Paired. Push is live on your iPhone." within 2s.
- [ ] Overlay dismisses on the phone. Pairing cookie and `localStorage.pairingToken` are cleared.

### 3. SMS fallback

Run on both Android and iOS.

- [ ] On desktop, type a valid AU mobile (`0412 345 678`). Hit "Text me the link".
- [ ] Inline message reads "Link sent. Check your phone." Button shows the 30s cooldown countdown.
- [ ] SMS arrives within 10s. Body matches: `Take Horace with you: <url> — Seize the moment.`
- [ ] Tap the link. Same flow as the QR happy path completes.

### 4. Token expired pre-scan

- [ ] Generate a QR. Wait 16 minutes without scanning.
- [ ] Scan the QR. Phone shows "This link's expired. Head back to your desktop and grab a new one." copy.
- [ ] Desktop side: the polling shows the expired card and the "Generate a new code" button appears (local wall-clock check; no server round-trip needed).
- [ ] Click "Generate a new code". New QR renders. Old QR now 404s if re-scanned.

### 5. Token already consumed

- [ ] Complete a successful pair (case 1 or 2). Desktop is on the Paired pill.
- [ ] Re-scan the now-consumed QR on a different device (or after clearing the phone's session).
- [ ] Phone shows "Already paired. You're good to go." copy.

### 6. Push denied on phone

- [ ] Repeat case 1 or 2, but at the push permission system dialog tap "Don't allow".
- [ ] Phone shows "No worries. You can turn this on later in settings." copy.
- [ ] Desktop still flips to "Paired" within 2s — with an additional note that alerts are off and can be changed in settings.
- [ ] `pairing_tokens.consumed_outcome` is `push_denied_but_installed`. No new `push_subscriptions` row.

### 7. Push API unsupported

- [ ] Open the install URL in an in-app browser or Firefox iOS (no Push API).
- [ ] Page renders the unsupported-browser copy directing the user to Safari/Chrome.
- [ ] No completion event fires; `pairing_tokens` row remains un-consumed.

### 8. SMS provider failure

Requires staging or temporarily setting `TWILIO_ACCOUNT_SID=ACxxx` (stub mode logs but doesn't actually call Twilio — or use the staging env's failure injection if available).

- [ ] Submit the SMS form. If staging is set to fail, the inline message reads "Couldn't send. Try again or scan the QR." 502 in the network panel.
- [ ] `pairing_tokens.sms_sends_count` does NOT increment (fail-closed accounting).
- [ ] Retry succeeds normally once Twilio is restored.

### 9. Re-pair after success

- [ ] Complete case 1 (Android pair). Desktop on Paired pill.
- [ ] Manually navigate the desktop back to the pair step (or roll back `last_completed_step` to `'notify'` and refresh).
- [ ] Generate a new pair token. Pair a second phone (or the same phone freshly).
- [ ] Both `push_subscriptions` rows are present for the agent (multi-device by design).
- [ ] Send a test push from the paired-state button. Both devices receive the push.

### 10. Desktop tab close mid-pair

- [ ] On desktop, generate a QR. Close the tab without completing pair.
- [ ] On the phone, complete the pair flow (case 1 or 2).
- [ ] Re-open `/onboarding` on the desktop. The heal-forward logic in `onboarding/page.tsx` bumps `last_completed_step` to `'pair'`; the wizard lands on the paired pill directly.
- [ ] Click Continue — wizard advances to reveal.

### 11. Two-desktop-tab race

- [ ] Open `/onboarding` on the pair step in Tab A. QR renders.
- [ ] Open `/onboarding` in Tab B in the same browser. Tab B generates a NEW token; Tab A's QR is now stale (the prior un-consumed row was revoked).
- [ ] Scan Tab A's QR. Phone shows the expired copy.
- [ ] Scan Tab B's QR. Pair completes. Both tabs flip to Paired (both poll the same status endpoint).

### 12. Same-browser-profile redemption (degraded path)

- [ ] On desktop, scan the QR using a phone tool that uses the same browser profile (rare — typically only happens in test setups).
- [ ] Expected: the magic-link redemption rotates the Supabase session. Desktop session is invalidated.
- [ ] Documented as known-degraded — the install copy directs the user to open the link on a different device.

---

## Known limitations

These are accepted trade-offs, not bugs:

- **Two-tab race produces a stale QR.** When a second desktop tab issues a fresh pairing token, the first tab's QR becomes a defunct token (404 on scan). The plan-time alternative — caching plaintext server-side to dedup — was scoped out of v1. The user-facing impact is rare; the heal-forward logic in `/onboarding` covers the resume case.
- **iOS standalone push relies on cookie+localStorage durability across the Add-to-Home-Screen flow.** Pre-iOS 17 the cookie jar split between Safari and the standalone PWA, so we belt-and-brace with localStorage. Re-verify on each major iOS release.
- **Magic-link redemption invalidates the desktop session if scanned in the same browser profile.** Edge case; install copy warns "Open this link on your phone, not the same computer."

---

## Sign-off

Each release that ships HOR-56 surfaces:

- [ ] All 12 cases above ticked or recorded as known-degraded.
- [ ] All 7 acceptance criteria ticked.
- [ ] No regressions on the existing onboarding steps (script, contacts, notify, reveal).
- [ ] `pairing_tokens` table is healthy (no orphan rows, indexes intact).
- [ ] Twilio cost monitor shows expected SMS volume (a handful per agent during onboarding; not bulk).

Tester / date / sha:

| Tester | Date | sha | Notes |
| ------ | ---- | --- | ----- |
|        |      |     |       |

---

*Seize the moment — Horace*
