# G-NAF refresh — quarterly runbook

How the Geocoded National Address File gets refreshed in Horace each quarter. Owner: Andy. Cadence: **quarterly** (Feb / May / Aug / Nov), the week after PSMA publishes the new release.

This doc lives in the repo rather than as a Linear comment because the operation is irregular, partially manual, and touches prod. Every quarter someone needs to remember exactly what to do — that's this file.

---

## What it does

G-NAF is the canonical Australian address dataset, published by PSMA Australia under CC BY 4.0. Every quarter PSMA cuts a new release of ~14M addresses.

Horace's ingest script ([`scripts/gnaf/ingest.mjs`](/scripts/gnaf/ingest.mjs)) downloads that release, stages the raw PSV files, and atomically replaces our `gnaf.address_principal` and `gnaf.localities` tables with the new data. The schema and FK from `properties.gnaf_address_detail_pid` are designed so the swap is sub-second and existing app data isn't touched.

The Core Markets feature ([HOR-189](https://linear.app/gohorace/issue/HOR-189)) is the only consumer in V1.

---

## Hardware / access needed

Before starting:

- A laptop with **20 GB+ free disk** (the zip is ~3 GB, extracted ~8 GB)
- A fast internet connection (download is ~30 min on a typical home line)
- The **service-role DB connection string** for the target Supabase project (1Password → "Supabase prod — service-role DB", or the equivalent staging entry)
- Node 20+ and pnpm 9 (matches `package.json` `packageManager`)
- The repo cloned and `pnpm install` already run at the root

---

## Pre-flight

- [ ] `_migrations` is in sync (`supabase db push --dry-run` reports no pending migrations). Reconcile via the once-and-only-once procedure from [HOR-190](https://linear.app/gohorace/issue/HOR-190) if not.
- [ ] Migrations `20260517000001_gnaf_schema.sql` and `20260517000002_properties_gnaf_link.sql` are applied to the target DB.
- [ ] You know which **release tag** PSMA gave the new cut (e.g. `MAY26`). It's the suffix in the zip filename and what we stamp on every row.
- [ ] Disk: `df -h /tmp` shows ≥ 20 GB free, or pick a different `WORK_DIR`.

---

## Steps

### 1. Find the release URL

PSMA publishes via [data.gov.au G-NAF dataset](https://data.gov.au/data/dataset/geocoded-national-address-file-g-naf). The page lists the current zip under "Data and Resources". Copy the zip URL.

The URL is direct-download; no auth needed. Expect a filename like `G-NAF_MAY26_AUSTRALIA_GDA2020.zip` or similar — packaging has shifted over the years.

### 2. Set env

```bash
export GNAF_RELEASE_URL='https://data.gov.au/.../G-NAF_MAY26_AUSTRALIA_GDA2020.zip'
export GNAF_RELEASE_TAG='MAY26'
export SUPABASE_DB_URL='postgresql://postgres.PROJECT_REF:PASSWORD@aws-X-region.pooler.supabase.com:5432/postgres'
# Optional: filter to a state subset for dev/staging
# export GNAF_STATES='NSW'
# Optional: pick where the script downloads/extracts
# export WORK_DIR=/tmp/gnaf-MAY26
```

⚠️  The DB URL must be the **session pooler** (`pooler.supabase.com:5432`) or **direct** connection, not the transaction pooler — `COPY ... FROM STDIN` doesn't work over the transaction pooler.

### 3. Dry-run

```bash
cd ~/code/horace
node scripts/gnaf/ingest.mjs --dry-run
```

Watch the output. Expect, in order:

```
[hh:mm:ss] G-NAF ingest starting — release=MAY26, states=ACT,NSW,...
[hh:mm:ss] downloading <url> → /tmp/.../gnaf-MAY26.zip
[hh:mm:ss] download   5% ...
[hh:mm:ss] download  10% ...
... (~30 min)
[hh:mm:ss] extracting zip → /tmp/.../extracted
[hh:mm:ss] preparing gnaf_staging schema
[hh:mm:ss] COPY .../NSW_ADDRESS_DETAIL_psv.psv → gnaf_staging.address_detail
... (one per state per table; ~10 min)
[hh:mm:ss] building gnaf.address_principal_next
[hh:mm:ss] building gnaf.localities_next
[hh:mm:ss]   address_principal_next: ~14,000,000 rows
[hh:mm:ss]   localities_next: ~17,000 rows
[hh:mm:ss]     ACT: ~190,000 addresses
[hh:mm:ss]     NSW: ~4,000,000 addresses
[hh:mm:ss]     ... etc.
[hh:mm:ss] --dry-run: skipping rename swap.
```

Sanity-check the per-state counts against PSMA's release notes (linked from the data.gov.au page). They should be within a few percent of last quarter unless PSMA reissued the methodology.

### 4. Spot-check

In the SQL editor for the target project:

```sql
-- A known Sydney address (Bondi Junction Westfield):
SELECT address_detail_pid, locality_name, state_abbrev, postcode,
       latitude, longitude, primary_secondary
FROM gnaf.address_principal_next
WHERE state_abbrev = 'NSW'
  AND locality_name = 'BONDI JUNCTION'
LIMIT 5;

-- A known sub-dwelling-heavy locality:
SELECT primary_secondary, count(*)
FROM gnaf.address_principal_next
WHERE locality_name = 'PYRMONT' AND state_abbrev = 'NSW'
GROUP BY primary_secondary;
```

You should see rows with sensible lat/lng, a mix of P and S, and a postcode for each.

### 5. Commit the swap

If everything looks right:

```bash
node scripts/gnaf/ingest.mjs --skip-download   # reuses the extracted files
```

This rebuilds `_next` (fast) and runs the rename swap. The swap is in a single transaction — Postgres takes brief AccessExclusiveLocks but real-world it's sub-second.

The script also runs `ANALYZE` on the new tables and drops `gnaf_staging`.

### 6. Post-swap verification

```sql
SELECT count(*) FROM gnaf.address_principal;
SELECT count(*) FROM gnaf.localities;
SELECT max(gnaf_release) FROM gnaf.address_principal;  -- should be the new tag

-- FKs recreated correctly?
SELECT conname, conrelid::regclass, confrelid::regclass, convalidated
FROM pg_constraint
WHERE conname IN (
  'address_principal_locality_pid_fkey',
  'properties_gnaf_address_detail_pid_fkey'
);
-- Expect both rows. `convalidated = false` is fine — we add them
-- NOT VALID for speed (see note below). All future INSERT/UPDATE
-- against the columns is enforced normally.

-- Sanity: properties → gnaf join still works
SELECT count(*)
FROM properties p
JOIN gnaf.address_principal ap ON ap.address_detail_pid = p.gnaf_address_detail_pid;
```

The properties → gnaf join should match the count from before the swap. **The address_detail_pid values themselves don't move between releases unless PSMA retires them** — so existing references typically all remain valid.

**Why the FKs are re-created each refresh:** `DROP TABLE … CASCADE` removes the FK constraint itself (constraints bind to the referenced table's OID, not its name). The ingest script re-adds both FKs (`gnaf.address_principal.locality_pid → gnaf.localities` and `public.properties.gnaf_address_detail_pid → gnaf.address_principal`) inside the same swap transaction, using `NOT VALID` so existing rows aren't re-scanned. To force a full re-validation later (e.g. after a release where PSMA retired pids):

```sql
ALTER TABLE public.properties
  VALIDATE CONSTRAINT properties_gnaf_address_detail_pid_fkey;
```

This takes an AccessShareLock and a SHARE UPDATE EXCLUSIVE lock on properties — fine to run during off-peak hours.

### 7. Trust page attribution

Update the CC BY 4.0 attribution date on the Trust page ([HOR-197](https://linear.app/gohorace/issue/HOR-197)). The string is a static constant; bump to the new release tag.

### 8. Announce

Post in `#engineering`:

> G-NAF refreshed to **MAY26**. Totals: 14,032,891 addresses across 17,234 localities (was 13,987,xxx / 17,2xx on FEB26). Spot-check passed. No follow-up needed.

---

## Failure modes & recovery

### Script dies mid-download

Re-run. The script detects an existing zip at `${WORK_DIR}/gnaf-${TAG}.zip` and skips re-downloading. To force a re-download, delete the zip.

### Script dies during staging COPY

The whole `gnaf_staging` schema gets dropped at the top of each run, so re-running is idempotent. Re-run with `--skip-download` to reuse the extracted PSVs.

### Script dies during the swap

The swap is in a single transaction wrapped with `BEGIN`/`COMMIT`. If the script dies before `COMMIT`, the transaction rolls back and you're left with `_next` tables alongside the live ones — same state as `--dry-run`. Re-run without `--dry-run` to retry.

If the script dies **after** `COMMIT` but before `DROP SCHEMA gnaf_staging`, you have stale staging data lying around. Drop it manually:

```sql
DROP SCHEMA IF EXISTS gnaf_staging CASCADE;
```

### Bad release (rare)

PSMA has occasionally shipped a release with widespread retired-flag or geocoding regressions. If a spot check shows wildly wrong totals (>10% drop in a state, or a major suburb missing), don't run the swap. Discard the staged tables:

```sql
DROP TABLE IF EXISTS gnaf.address_principal_next;
DROP TABLE IF EXISTS gnaf.localities_next;
DROP SCHEMA IF EXISTS gnaf_staging CASCADE;
```

Wait for PSMA's revision (usually a week) and re-run.

### Reverting after a bad swap

We don't keep the old tables around (the swap drops them with `CASCADE`). If a swap clearly went bad and we need the previous release, re-run the script with the **previous** `GNAF_RELEASE_URL` and `GNAF_RELEASE_TAG`. There's no in-place rollback path other than a full re-ingest of the prior release.

---

## Why this is manual in V1

- The full national zip is ~3 GB. Downloading it from inside a Supabase Edge Function or Vercel function blows the timeout / memory budgets every time.
- Quarterly cadence is slow enough that automating it doesn't pay back the design effort for V1.
- We want a human in the loop for the row-count sanity check, especially on PSMA's occasional regression releases.

V1.5: stage the release zip in S3 first (CDN-mirrored), then a Supabase Edge Function streams it into staging without needing a laptop. Brief refresh notes go in `docs/briefs/gnaf-refresh-v2.md` when this becomes worth doing.

---

## Licensing

G-NAF is published by PSMA Australia Limited under [Creative Commons Attribution 4.0 (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/). The attribution is rendered on Horace's Trust page (see [HOR-197](https://linear.app/gohorace/issue/HOR-197)).
