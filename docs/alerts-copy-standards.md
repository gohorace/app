# Alerts copy standards

The bar for every alert Horace sends. Use this checklist when writing or reviewing alert copy.

Source of truth for the principles: the Alerts & Notifications brief, captured on the Linear [project description](https://linear.app/gohorace/project/alerts-and-notifications-02f66872bea5). This doc is the operational distillation — the thing you actually open when writing a string.

---

## Who voices what

| Channel / surface | Voice | Sign-off |
| - | - | - |
| Push alerts (all designed semantic alerts) | First-person Horace | None (push is too short) |
| Email alerts and digests (`weekly_patch_digest`, `daily_briefing`, `quiet_period_reassurance`, `csv_import_complete`) | First-person Horace | *Seize the moment — Horace* |
| Operational emails (`agent_invited`, `agent_departed`, `export_ready`, auth: `signup`, `magiclink`, `recovery`, `email_change`, `invite`, `reauthentication`, `password_reset`, `login_from_new_device`, `billing_failure`, `subscription_expiring`) | The Horace team — transactional, system-toned | *— The Horace team* |
| In-app activity feed entries | Mirror the push copy verbatim where one fired; for events that didn't trigger push, use a quieter retrospective tone ("Horace logged…") | None |

If you can't tell whether something is a Horace-voiced alert or an operational email, ask: *does this carry signal that changes what the agent does next?* Yes → Horace-voiced. No → team-voiced.

---

## Brand voice rules (from brief)

* **First person from Horace.** "Horace noticed", "Horace thinks", "Horace is watching". Horace speaks. The system never speaks as itself.
* **Conversational tone.** What a colleague would say leaning over your desk, not what a notification framework would emit. *"Sarah's been back three times this week"* — not *"Contact engagement threshold exceeded."*
* **Specific over generic.** Name the contact. Name the property. Name the suburb. *"Sarah's looking at sales in her own suburb"* — not *"A known contact viewed sold results."*
* **Action implicit, not commanded.** *"Worth a call."* — not *"Call Sarah now."*
* **No emojis.** Not in titles, not in bodies, not in subjects, not anywhere.
* **No exclamation marks.** Horace doesn't shout.
* **Sentence case in email subject lines, no full stops.** *"What Horace picked up this week"* — not *"What Horace Picked Up This Week."*

---

## Copy review checklist

Every alert string — push title, push body, email subject, email body, in-app feed entry — must pass this checklist before merge. Reference it from the acceptance section of every per-alert issue.

- [ ] First person from Horace ("Horace noticed", "Horace thinks", "Horace is watching")
- [ ] Conversational tone — what a colleague would say, not a notification
- [ ] Specific over generic — names the contact, property, suburb
- [ ] Action implicit, not commanded ("worth a call" not "Call Sarah now")
- [ ] No emojis
- [ ] No exclamation marks
- [ ] Email signs off *Seize the moment — Horace*; push has no sign-off (too short)
- [ ] Sentence case in subject lines, no full stops
- [ ] If operational: sender is "The Horace team", sign-off is *— The Horace team*, no Horace first-person inside the body
- [ ] AU vocabulary used (see swap table below)

---

## AU vocabulary swap table

Horace's voice is AU-tuned in V1. Localisation is deferred ([HOR-70](https://linear.app/gohorace/issue/HOR-70)). Use the left column; never the right. If and when an international customer lands, the swap is editorial — keep it that way by writing only the canonical forms today.

| Use (AU) | Don't use |
| - | - |
| appraisal | valuation |
| patch | territory, region, area |
| suburb | neighborhood, neighbourhood, area, district |
| sold results | comps, comparables |
| agent | realtor, broker |
| listing | property listing |
| enquiry | inquiry |
| Seize the moment | Seize the day, Carpe diem |
| watching | tracking, monitoring |

---

## Examples — good vs. don't

### Push: high-intent signal

**Don't:**
> *Something's stirring.*
> *Sarah just crossed your threshold. Might be worth a call.*

Generic, system-toned, no Horace voice, no specifics. Fires on any score crossing — same copy whether the signal is an appraisal-page hit or a return visit.

**Do** ([HOR-81](https://linear.app/gohorace/issue/HOR-81), `appraisal_page_visit`):
> *Sarah just looked at your appraisal page. She didn't fill the form — but she was there. Worth a call.*

Specific page named. Action implicit. Tone is colleague-over-the-desk.

### Push: lead capture

**Don't:**
> *They raised their hand.*
> *Sarah just submitted "Appraisal request". Worth a follow-up now.*

"They" is impersonal; doesn't lean on what makes this signal specific (it was an appraisal-form submission from a portal).

**Do** ([HOR-78](https://linear.app/gohorace/issue/HOR-78), `portal_enquiry_received`):
> *Sarah Chen just enquired on 12 Maple St via REA. Horace has set her up — first reply via Horace and he'll start watching her properly.*

Names contact, property, source. Teaches the behaviour that makes the product valuable (reply via Horace to bind the device).

### Email: empty-state digest

**Don't:**
> Subject: *No new activity this week*
>
> *Your patch was quiet this week. No new contacts identified, no new alerts. Check back next week.*

Reads like absence of signal = absence of work. Confirms the agent's fear that the slow weeks aren't being worked.

**Do** ([HOR-92](https://linear.app/gohorace/issue/HOR-92), `quiet_period_reassurance`):
> Subject: *Horace is watching*
>
> *Horace is watching. Nothing worth your attention yet this week — but your patch had 14 anonymous visitors poking around. Some of them will surface.*
>
> *Quiet weeks are when the next listing is being researched. Horace will let you know the moment something stirs.*
>
> *Seize the moment — Horace*

Horace is *with* the agent in the quiet. Reassures without overpromising.

### Operational email: invite

**Don't:**
> Subject: *Andy invited you to Bay & Co on Horace*
>
> *Welcome to Horace! Tap below to accept.*
>
> *Seize the moment — Horace*

Operational events don't get Horace's voice. Signing off as Horace blurs the line between "Horace noticed something for you" and "the system did a thing".

**Do** ([HOR-93](https://linear.app/gohorace/issue/HOR-93), `agent_invited`):
> Subject: *Andy invited you to Bay & Co on Horace*
>
> *Andy invited you to join Bay & Co as an agent. Tap the button below to accept and sign in.*
>
> *— The Horace team*

---

## Subject line conventions

* **Daily briefing:** *Your daily brief — N to act on*. If empty: *Your daily brief — quiet today*.
* **Weekly patch digest:** *What Horace picked up this week*.
* **Quiet-period reassurance:** *Horace is watching*.
* **CSV import complete:** *Your import is done*.
* **Operational (auth):** literal action — *Sign in to Horace*, *Confirm your email*, *Recover your account*.
* **Operational (account):** descriptive — *Your Horace export is ready*, *Your subscription expires soon*.

Never use:
* Title Case ("Your Daily Brief")
* Trailing punctuation ("Your daily brief.")
* Numerals where words read better ("1 to act on" → "one" only if the count is the whole subject; otherwise digit is fine)
* "[Alert]" or "[Notification]" prefixes

---

## When you're writing a new alert

1. Pull up this doc and the brief.
2. Draft the push (or email) copy alongside the trigger spec on the Linear issue.
3. Run it past the checklist. Honestly — if a bullet is "kind of" yes, treat it as no.
4. Test it in staging using the simulate endpoint ([HOR-69](https://linear.app/gohorace/issue/HOR-69)).
5. PR description quotes the final copy and references this doc.

If you find yourself wanting a generic catch-all template ("a contact did a thing — check it out"), the alert isn't designed yet. Go back to the trigger.

---

## Maintenance

* This doc lives at `docs/alerts-copy-standards.md`.
* Update both this and the project description on Linear when something changes here.
* When adding a new alert type, add a line under "Who voices what" and (if it has a stable subject) under "Subject line conventions".
* Last reviewed: 2026-05-12 ([HOR-73](https://linear.app/gohorace/issue/HOR-73)).
