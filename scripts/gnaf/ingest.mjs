#!/usr/bin/env node
/**
 * G-NAF ingest — quarterly bulk load.
 *
 * Downloads PSMA's Geocoded National Address File release, extracts the
 * per-state PSVs we need, COPYs them into a transient `gnaf_staging`
 * schema, joins them into `gnaf.address_principal_next` + `gnaf.localities_next`,
 * then atomically renames `_next → live` and drops the old.
 *
 * Run from an operator laptop with the prod (or staging) service-role
 * DB connection string. NEVER expose this as an API route — it's a
 * one-off pipeline that takes ~30 min nationally on a fast box.
 *
 * Usage:
 *
 *   GNAF_RELEASE_URL=https://...G-NAF_MAY26.zip \
 *   GNAF_RELEASE_TAG=MAY26 \
 *   SUPABASE_DB_URL=postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres \
 *   node scripts/gnaf/ingest.mjs
 *
 *   # Dev / dry-run options:
 *   GNAF_STATES=NSW           # filter to a state subset (default: all 8)
 *   WORK_DIR=/tmp/gnaf-MAY26  # where to download/extract (default: os.tmpdir())
 *   node scripts/gnaf/ingest.mjs --dry-run        # stage but skip the rename swap
 *   node scripts/gnaf/ingest.mjs --skip-download  # reuse files already in WORK_DIR
 *
 * Required env:
 *   GNAF_RELEASE_URL   public PSMA zip URL (from data.gov.au)
 *   GNAF_RELEASE_TAG   short tag stamped on every row (e.g. "MAY26")
 *   SUPABASE_DB_URL    postgres connection string with service-role privileges
 *
 * Optional env:
 *   GNAF_STATES        comma-separated states ("NSW,VIC"). Defaults to all.
 *   WORK_DIR           scratch directory. Defaults to `${os.tmpdir()}/gnaf-${tag}`.
 *
 * Prereqs:
 *   • `pnpm install` from repo root (adds pg, pg-copy-streams, unzipper)
 *   • supabase/migrations/20260517000001 + 20260517000002 applied
 *   • Free disk: ~20 GB (zip + extract).
 *
 * See docs/gnaf-refresh.md for the full quarterly runbook.
 */

import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { request as httpsRequest } from 'node:https'
import { URL } from 'node:url'

import pg from 'pg'
import { from as copyFrom } from 'pg-copy-streams'
import unzipper from 'unzipper'

const { Client } = pg

// ────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────

const ALL_STATES = ['ACT', 'NSW', 'NT', 'OT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']

/**
 * PSMA tables we stage. Order matters for FK satisfaction during JOIN.
 * Column names match PSMA's create-table DDL (lowercase to match Postgres
 * default behaviour with COPY); we declare staging columns as `text` to
 * be tolerant of any release-to-release schema drift, and cast in the join.
 */
const STAGING_TABLES = [
  {
    name: 'state',
    columns: [
      'state_pid', 'date_created', 'date_retired',
      'state_name', 'state_abbreviation',
    ],
    // FEB26 ships per-state STATE files (e.g. QLD_STATE_psv.psv), each
    // containing the single row for that state. Older PSMA releases used
    // a national Authority_Code_STATE_psv.psv (or bare STATE_psv.psv) —
    // see the `matcherFallback` logic below for that legacy path.
    perState: true,
  },
  {
    name: 'locality',
    columns: [
      'locality_pid', 'date_created', 'date_retired',
      'locality_name', 'primary_postcode',
      'locality_class_code', 'state_pid',
      'gnaf_locality_pid', 'gnaf_reliability_code',
    ],
    perState: true,
  },
  {
    name: 'street_locality',
    columns: [
      'street_locality_pid', 'date_created', 'date_retired',
      'street_class_code', 'street_name', 'street_type_code',
      'street_suffix_code', 'locality_pid',
      'gnaf_street_pid', 'gnaf_street_confidence', 'gnaf_reliability_code',
    ],
    perState: true,
  },
  {
    name: 'address_detail',
    columns: [
      'address_detail_pid', 'date_created', 'date_last_modified', 'date_retired',
      'building_name',
      'lot_number_prefix', 'lot_number', 'lot_number_suffix',
      'flat_type_code',
      'flat_number_prefix', 'flat_number', 'flat_number_suffix',
      'level_type_code',
      'level_number_prefix', 'level_number', 'level_number_suffix',
      'number_first_prefix', 'number_first', 'number_first_suffix',
      'number_last_prefix', 'number_last', 'number_last_suffix',
      'street_locality_pid',
      'location_description',
      'locality_pid',
      'alias_principal', 'postcode', 'private_street', 'legal_parcel_id',
      'confidence', 'address_site_pid', 'level_geocoded_code',
      'property_pid', 'gnaf_property_pid', 'primary_secondary',
    ],
    perState: true,
  },
  {
    name: 'address_default_geocode',
    columns: [
      'address_default_geocode_pid', 'date_created', 'date_retired',
      'address_detail_pid', 'geocode_type_code', 'longitude', 'latitude',
    ],
    perState: true,
  },
]

// ────────────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────────────

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const SKIP_DOWNLOAD = args.has('--skip-download')

const RELEASE_URL = process.env.GNAF_RELEASE_URL
const RELEASE_TAG = process.env.GNAF_RELEASE_TAG
const DB_URL = process.env.SUPABASE_DB_URL
const STATES = (process.env.GNAF_STATES?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)) || ALL_STATES
const WORK_DIR = process.env.WORK_DIR || join(tmpdir(), `gnaf-${RELEASE_TAG || 'unknown'}`)

if (!SKIP_DOWNLOAD && !RELEASE_URL) {
  fatal('GNAF_RELEASE_URL is required (or pass --skip-download with files already in WORK_DIR)')
}
if (!RELEASE_TAG) fatal('GNAF_RELEASE_TAG is required (e.g. MAY26)')
if (!DB_URL) fatal('SUPABASE_DB_URL is required')
for (const s of STATES) {
  if (!ALL_STATES.includes(s)) fatal(`Unknown state code: ${s}. Valid: ${ALL_STATES.join(', ')}`)
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/** @param {string} msg */
function fatal(msg) {
  console.error(`FATAL: ${msg}`)
  process.exit(1)
}

/** @param {string} msg */
function log(msg) {
  const t = new Date().toISOString().slice(11, 19)
  console.log(`[${t}] ${msg}`)
}

/**
 * Stream a HTTPS URL to a file. Follows up to 3 redirects.
 *
 * @param {string} url
 * @param {string} destPath
 * @param {number} [hops]
 */
async function downloadTo(url, destPath, hops = 0) {
  if (hops > 3) throw new Error(`Too many redirects from ${url}`)
  await mkdir(dirname(destPath), { recursive: true })
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = httpsRequest({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': 'horace-gnaf-ingest' },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0) && res.headers.location) {
        res.resume()
        const next = new URL(res.headers.location, url).toString()
        log(`redirect → ${next}`)
        downloadTo(next, destPath, hops + 1).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} on ${url}`))
        return
      }
      const total = Number(res.headers['content-length'] || 0)
      let seen = 0
      let lastPct = -1
      res.on('data', (chunk) => {
        seen += chunk.length
        if (total > 0) {
          const pct = Math.floor((seen / total) * 100)
          if (pct >= lastPct + 5) {
            log(`download ${pct}% (${(seen / 1e9).toFixed(2)} / ${(total / 1e9).toFixed(2)} GB)`)
            lastPct = pct
          }
        }
      })
      pipeline(res, createWriteStream(destPath)).then(resolve, reject)
    })
    req.on('error', reject)
    req.end()
  })
}

/**
 * Extract a zip into a target directory using `unzipper`. Streams every
 * entry to disk — memory use stays flat regardless of archive size.
 *
 * @param {string} zipPath
 * @param {string} destDir
 */
async function extractZip(zipPath, destDir) {
  await mkdir(destDir, { recursive: true })
  await pipeline(
    createReadStream(zipPath),
    unzipper.Extract({ path: destDir }),
  )
}

/**
 * Walk a directory tree looking for files whose name matches `pattern`.
 *
 * @param {string} root
 * @param {RegExp} pattern
 * @returns {Promise<string[]>}
 */
async function findFiles(root, pattern) {
  /** @type {string[]} */
  const hits = []
  /** @param {string} dir */
  const walk = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) await walk(full)
      else if (pattern.test(e.name)) hits.push(full)
    }
  }
  await walk(root)
  return hits.sort()
}

/**
 * Build the CREATE TABLE statement for a staging table. All columns
 * declared as `text` so we don't have to track PSMA's per-release
 * column-type variations; casts happen during the join.
 *
 * @param {{name: string, columns: string[]}} table
 */
function stagingDdl(table) {
  const cols = table.columns.map((c) => `  ${c} text`).join(',\n')
  return `CREATE TABLE gnaf_staging.${table.name} (\n${cols}\n);`
}

/**
 * Stream a PSV file into a staging table via `COPY ... FROM STDIN`.
 * PSMA's PSVs are pipe-delimited with a single header row.
 *
 * @param {pg.Client} client
 * @param {string} schemaTable
 * @param {string[]} columns
 * @param {string} psvPath
 */
async function copyPsv(client, schemaTable, columns, psvPath) {
  const colList = columns.join(', ')
  const stream = client.query(copyFrom(
    `COPY ${schemaTable} (${colList}) FROM STDIN WITH (
       FORMAT csv, HEADER true, DELIMITER '|', NULL '', QUOTE E'\\b'
     )`,
  ))
  await pipeline(createReadStream(psvPath), stream)
}

// ────────────────────────────────────────────────────────────────────
// Main pipeline
// ────────────────────────────────────────────────────────────────────

async function main() {
  log(`G-NAF ingest starting — release=${RELEASE_TAG}, states=${STATES.join(',')}, dry-run=${DRY_RUN}`)
  log(`WORK_DIR=${WORK_DIR}`)

  // ── 1. Acquire the release zip ─────────────────────────────────────
  await mkdir(WORK_DIR, { recursive: true })
  const zipPath = join(WORK_DIR, `gnaf-${RELEASE_TAG}.zip`)
  const extractDir = join(WORK_DIR, 'extracted')

  if (SKIP_DOWNLOAD) {
    if (!existsSync(extractDir)) fatal(`--skip-download set but ${extractDir} doesn't exist`)
    log('skipping download (--skip-download)')
  } else if (existsSync(zipPath) && (await stat(zipPath)).size > 0) {
    log(`zip already present at ${zipPath} — skipping download. Delete the file to force a re-download.`)
  } else {
    log(`downloading ${RELEASE_URL} → ${zipPath}`)
    await downloadTo(RELEASE_URL, zipPath)
  }

  if (!SKIP_DOWNLOAD) {
    if (existsSync(extractDir)) {
      log(`removing previous extract at ${extractDir}`)
      await rm(extractDir, { recursive: true, force: true })
    }
    log(`extracting zip → ${extractDir}`)
    await extractZip(zipPath, extractDir)
  }

  // ── 2. Connect ─────────────────────────────────────────────────────
  const client = new Client({ connectionString: DB_URL, statement_timeout: 0 })
  await client.connect()

  // The constructor's `statement_timeout: 0` doesn't always stick through
  // Supabase's pooler — defensively set it again here. 30 min is comfortable
  // for any single step on Nano compute (build step took 44s on QLD dry-run
  // but Nano load can spike; default Supabase server-side timeout is ~60s).
  await client.query(`SET statement_timeout = '30min'`)
  await client.query(`SET lock_timeout      = '5min'`)
  await client.query(`SET idle_in_transaction_session_timeout = '30min'`)

  try {
    // ── 3. Stage raw PSMA tables in `gnaf_staging` ───────────────────
    log('preparing gnaf_staging schema')
    await client.query('DROP SCHEMA IF EXISTS gnaf_staging CASCADE')
    await client.query('CREATE SCHEMA gnaf_staging')
    for (const table of STAGING_TABLES) {
      await client.query(stagingDdl(table))
    }

    for (const table of STAGING_TABLES) {
      const matcher = table.perState
        ? new RegExp(`^(${STATES.join('|')})_${table.name.toUpperCase()}_psv\\.psv$`, 'i')
        : new RegExp(`^Authority_Code_${table.name.toUpperCase()}_psv\\.psv$`, 'i')
      // Fall back to AUTH-style file naming for the national `state` table —
      // PSMA's packaging has shifted releases between Authority_Code_STATE
      // and a plain STATE_psv across the years; match either.
      const matcherFallback = !table.perState
        ? new RegExp(`^STATE_psv\\.psv$`, 'i')
        : null

      const files = (await findFiles(extractDir, matcher))
        .concat(matcherFallback ? await findFiles(extractDir, matcherFallback) : [])

      if (files.length === 0) {
        fatal(`no PSV files found for table=${table.name}, states=${STATES.join(',')} under ${extractDir}`)
      }

      for (const file of files) {
        log(`COPY ${file.replace(extractDir, '…')} → gnaf_staging.${table.name}`)
        await copyPsv(client, `gnaf_staging.${table.name}`, table.columns, file)
      }
    }

    // ── 4. Build gnaf.address_principal_next ─────────────────────────
    //
    // Drop NEW tables on each run so the dry-run flag is genuinely
    // idempotent — partial state from a previous failed attempt gets
    // cleared rather than carried forward.
    log('building gnaf.address_principal_next')
    await client.query('DROP TABLE IF EXISTS gnaf.address_principal_next')
    await client.query(`
      CREATE TABLE gnaf.address_principal_next (LIKE gnaf.address_principal INCLUDING ALL);
    `)
    // The `state` table primary key is `state_pid`; PSMA distributes
    // state_abbreviation in there. We join through it so the result
    // carries the 'NSW' / 'VIC' string we surface in the UI.
    //
    // Retired addresses (date_retired NOT NULL and in the past) are
    // excluded — keeping them would pollute the suburb-picker results
    // and the per-suburb import counts.
    //
    // Note on filters:
    //   • COPY's `NULL ''` config converts empty PSV cells → SQL NULL,
    //     so we don't need an `OR field = ''` branch anywhere.
    //   • confidence: PSMA's scale is -1 (no geocode), 0 (low / approx
    //     geocode), 1 (good), 2 (high). Original V1 used `>= 1` but
    //     that dropped ~90% of real addresses in some suburbs — they
    //     were ABS-known dwellings with imprecise lat/lng. Loosened to
    //     `>= 0` so we keep low-confidence-geocode addresses (the
    //     postal address is still valid; the map view just won't get a
    //     precise pin). Caught smoke-testing Currimundi (only 5 of 59
    //     Buderim addresses present at `>= 1`). 2026-05-18.
    //   • date_retired: NULL means active. Anything non-null means
    //     the address was withdrawn — exclude.
    //   • primary_secondary: PSMA marks address_detail rows as 'P'
    //     (principal of a complex with sub-dwellings), 'S' (sub-dwelling
    //     within a P), or NULL (standalone address — no hierarchy). The
    //     V1 ingest only kept P + S, which dropped ~70% of legitimate
    //     addresses (every standalone house etc.). Now keep NULL too —
    //     a standalone house is still a property we want in the picker.
    //     Caught smoke-testing Currimundi: 2462 NULL + 775 S + 159 P =
    //     3396 raw rows; the old IN ('P','S') filter kept only 934.
    //     2026-05-18.
    // Chunked INSERT — a single-statement bulk insert of 3M+ rows hits
    // Supabase Nano's 30-min statement_timeout even with indexes-on-the-fly.
    // Process the staging table in slices of CHUNK_SIZE rows keyed by
    // address_detail_pid (the staging PK). Each chunk runs as its own
    // statement and stays well under the timeout. Total wall time is
    // similar to one big INSERT but each piece is bounded.
    //
    // The cursor is text-ordered on address_detail_pid (e.g.
    // 'GAQLD123...'). Empty string sorts before any real pid, so we
    // can use it as the initial cursor without a special-case branch.
    const CHUNK_SIZE = 200000
    let cursor = ''
    let chunkNum = 0
    let totalInserted = 0
    while (true) {
      chunkNum++
      const chunkStart = Date.now()
      const result = await client.query(`
        WITH chunk AS (
          SELECT ad.*
          FROM gnaf_staging.address_detail ad
          WHERE ad.address_detail_pid > $2
          ORDER BY ad.address_detail_pid
          LIMIT ${CHUNK_SIZE}
        ),
        ins AS (
          INSERT INTO gnaf.address_principal_next (
            address_detail_pid, locality_pid, street_locality_pid,
            flat_type, flat_number_prefix, flat_number, flat_number_suffix,
            level_type, level_number,
            number_first_prefix, number_first, number_first_suffix,
            number_last,
            street_name, street_type_code, street_suffix_code,
            locality_name, state_abbrev, postcode,
            latitude, longitude,
            primary_secondary, gnaf_release
          )
          SELECT
            ad.address_detail_pid,
            ad.locality_pid,
            ad.street_locality_pid,
            ad.flat_type_code,
            ad.flat_number_prefix, ad.flat_number, ad.flat_number_suffix,
            ad.level_type_code, ad.level_number,
            ad.number_first_prefix, ad.number_first, ad.number_first_suffix,
            ad.number_last,
            sl.street_name,
            sl.street_type_code,
            sl.street_suffix_code,
            l.locality_name,
            s.state_abbreviation AS state_abbrev,
            ad.postcode,
            adg.latitude::numeric(10, 7)  AS latitude,
            adg.longitude::numeric(10, 7) AS longitude,
            ad.primary_secondary,
            $1 AS gnaf_release
          FROM chunk ad
          JOIN gnaf_staging.street_locality sl ON sl.street_locality_pid = ad.street_locality_pid
          JOIN gnaf_staging.locality l         ON l.locality_pid         = ad.locality_pid
          JOIN gnaf_staging.state s            ON s.state_pid            = l.state_pid
          LEFT JOIN gnaf_staging.address_default_geocode adg
            ON adg.address_detail_pid = ad.address_detail_pid
          WHERE COALESCE(ad.confidence::int, -1) >= 0
            AND ad.date_retired IS NULL
            AND (ad.primary_secondary IS NULL OR ad.primary_secondary IN ('P', 'S'))
          RETURNING 1
        )
        SELECT
          (SELECT count(*)::int FROM chunk) AS examined,
          (SELECT count(*)::int FROM ins) AS inserted,
          (SELECT max(address_detail_pid) FROM chunk) AS last_pid
      `, [RELEASE_TAG, cursor])

      const { examined, inserted, last_pid } = result.rows[0]
      if (examined === 0) break
      cursor = last_pid
      totalInserted += inserted
      const secs = ((Date.now() - chunkStart) / 1000).toFixed(1)
      log(`  chunk ${chunkNum}: examined=${examined}, inserted=${inserted}, total=${totalInserted} (${secs}s)`)
    }

    // ── 5. Build gnaf.localities_next ────────────────────────────────
    log('building gnaf.localities_next')
    await client.query('DROP TABLE IF EXISTS gnaf.localities_next')
    await client.query(`
      CREATE TABLE gnaf.localities_next (LIKE gnaf.localities INCLUDING ALL);
    `)
    // Lat/lng centroid is computed from gnaf.address_principal_next we
    // just built. Single GROUP BY pass (one seq/index scan + hash agg)
    // rather than the per-locality LATERAL aggregate the original used.
    // On 3.3M rows + 3,545 localities, the LATERAL took >25 min and
    // hit Supabase Nano's 30-min statement_timeout. The GROUP BY does
    // the same work in one pass and completes in ~30s. 2026-05-18.
    //
    // NULL lat/lng on address rows are skipped — AVG ignores NULLs
    // natively, so no WHERE filter needed.
    await client.query(`
      WITH centroids AS (
        SELECT locality_pid,
               AVG(latitude)  AS latitude,
               AVG(longitude) AS longitude
        FROM gnaf.address_principal_next
        GROUP BY locality_pid
      )
      INSERT INTO gnaf.localities_next (
        locality_pid, locality_name, state_abbrev, postcode,
        latitude, longitude, gnaf_release
      )
      SELECT
        l.locality_pid,
        l.locality_name,
        s.state_abbreviation AS state_abbrev,
        l.primary_postcode   AS postcode,
        c.latitude,
        c.longitude,
        $1 AS gnaf_release
      FROM gnaf_staging.locality l
      JOIN gnaf_staging.state s ON s.state_pid = l.state_pid
      LEFT JOIN centroids c     ON c.locality_pid = l.locality_pid
      WHERE l.date_retired IS NULL
    `, [RELEASE_TAG])

    // ── 6. Verify ────────────────────────────────────────────────────
    const { rows: countRows } = await client.query(`
      SELECT 'address_principal'::text AS t, count(*)::bigint AS n FROM gnaf.address_principal_next
      UNION ALL
      SELECT 'localities'::text, count(*)::bigint FROM gnaf.localities_next
    `)
    for (const row of countRows) log(`  ${row.t}_next: ${Number(row.n).toLocaleString()} rows`)

    const { rows: byState } = await client.query(`
      SELECT state_abbrev, count(*)::bigint AS n
      FROM gnaf.address_principal_next
      GROUP BY state_abbrev ORDER BY state_abbrev
    `)
    for (const row of byState) log(`    ${row.state_abbrev}: ${Number(row.n).toLocaleString()} addresses`)

    // Sanity: a known address. We use the PSMA HQ address as the canary.
    // Skip the assertion if states filter excludes ACT.
    if (STATES.includes('ACT')) {
      const { rows: canary } = await client.query(`
        SELECT count(*)::int AS n FROM gnaf.address_principal_next
        WHERE state_abbrev = 'ACT' AND locality_name = 'CANBERRA'
        LIMIT 1
      `)
      if (canary[0].n === 0) fatal('canary check failed — no ACT/CANBERRA addresses in address_principal_next')
    }

    if (DRY_RUN) {
      log('--dry-run: skipping rename swap. _next tables left in place for inspection.')
      log('to commit a dry-run result, re-run without --dry-run (it will rebuild idempotently).')
      return
    }

    // ── 7. Atomic swap ───────────────────────────────────────────────
    // Single transaction:
    //   1. rename live → _old
    //   2. rename _next → live
    //   3. drop _old CASCADE — this drops the FK constraints pointing
    //      to the old tables (FKs are bound to the referenced table's
    //      OID, not its name, so they don't follow rename).
    //   4. recreate the dropped FK constraints, NOT VALID, so existing
    //      rows aren't re-scanned (would lock public.properties for
    //      minutes on a large table). Future INSERT/UPDATE/DELETE
    //      against the constraint columns are still enforced.
    //
    // Two FK constraints get dropped and recreated each quarter:
    //   • gnaf.address_principal.locality_pid → gnaf.localities
    //   • public.properties.gnaf_address_detail_pid → gnaf.address_principal
    //
    // Postgres takes an AccessExclusiveLock on each renamed table for
    // the duration of the transaction. Real-world it's sub-second.
    log('atomic swap: _next → live (+ FK re-creation)')
    await client.query('BEGIN')
    await client.query('ALTER TABLE gnaf.address_principal RENAME TO address_principal_old')
    await client.query('ALTER TABLE gnaf.localities         RENAME TO localities_old')
    await client.query('ALTER TABLE gnaf.address_principal_next RENAME TO address_principal')
    await client.query('ALTER TABLE gnaf.localities_next         RENAME TO localities')
    await client.query('DROP TABLE gnaf.address_principal_old CASCADE')
    await client.query('DROP TABLE gnaf.localities_old         CASCADE')
    // Restore FK: address_principal.locality_pid → localities.locality_pid
    await client.query(`
      ALTER TABLE gnaf.address_principal
        ADD CONSTRAINT address_principal_locality_pid_fkey
        FOREIGN KEY (locality_pid)
        REFERENCES gnaf.localities(locality_pid)
        NOT VALID
    `)
    // Restore FK: public.properties.gnaf_address_detail_pid →
    //             gnaf.address_principal.address_detail_pid
    // ON DELETE SET NULL preserves the original migration A2 contract.
    await client.query(`
      ALTER TABLE public.properties
        ADD CONSTRAINT properties_gnaf_address_detail_pid_fkey
        FOREIGN KEY (gnaf_address_detail_pid)
        REFERENCES gnaf.address_principal(address_detail_pid)
        ON DELETE SET NULL
        NOT VALID
    `)
    await client.query('COMMIT')

    // ── 8. Analyze + cleanup ─────────────────────────────────────────
    log('ANALYZE')
    await client.query('ANALYZE gnaf.address_principal')
    await client.query('ANALYZE gnaf.localities')

    // HOR-410: rebuild the derived street + complex references from the
    // freshly-swapped address_principal so the street/building import
    // pickers don't drift from the new quarterly data. No-op-safe if the
    // function isn't present yet (pre-HOR-410 environments).
    log('refreshing derived references (gnaf.street_localities, gnaf.complexes)')
    try {
      await client.query('SELECT gnaf.refresh_address_derivations()')
      await client.query('ANALYZE gnaf.street_localities')
      await client.query('ANALYZE gnaf.complexes')
    } catch (err) {
      log(`  WARN: refresh_address_derivations() failed or absent — ${err.message}`)
    }

    log('cleaning up gnaf_staging')
    await client.query('DROP SCHEMA gnaf_staging CASCADE')

    log('done.')
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* ignore */ }
    throw err
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
