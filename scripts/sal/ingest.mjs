#!/usr/bin/env node
/**
 * SAL suburb-boundary ingest — HOR-369.
 *
 * Loads ABS ASGS 2021 "Suburbs and Localities" (SAL) polygons into
 * `public.suburb_boundaries`, matched to the G-NAF locality_pid that
 * `get_suburb_signals` emits. QLD-first (matches Core Markets V1 G-NAF
 * coverage). Geometry is Douglas–Peucker simplified at a web-render tolerance
 * so the choropleth payload stays light.
 *
 * Like scripts/gnaf/ingest.mjs this is an OPERATOR-RUN pipeline, not an API
 * route: it needs the ABS GeoJSON on disk and a service-role DB connection.
 *
 * Usage:
 *
 *   SAL_GEOJSON_PATH=/data/SAL_2021_AUST_GDA2020.geojson \
 *   SUPABASE_DB_URL=postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres \
 *   node scripts/sal/ingest.mjs
 *
 *   # or download first (ABS / data.gov.au GeoJSON URL):
 *   SAL_GEOJSON_URL=https://.../SAL_2021_AUST_GDA2020.geojson \
 *   SUPABASE_DB_URL=... node scripts/sal/ingest.mjs
 *
 *   node scripts/sal/ingest.mjs --dry-run   # match + report, skip all writes
 *
 * Required env:
 *   SUPABASE_DB_URL     postgres connection string with service-role privileges
 *   SAL_GEOJSON_PATH    local path to the SAL GeoJSON (or set SAL_GEOJSON_URL)
 *
 * Optional env:
 *   SAL_GEOJSON_URL     download source if SAL_GEOJSON_PATH is absent
 *   SAL_STATES          comma-separated state abbrevs to load (default: QLD)
 *   SIMPLIFY_TOLERANCE  Douglas–Peucker epsilon in degrees (default 0.0005 ≈ 55m)
 *   SAL_SOURCE_VERSION  stamped on every row (default "GDA2020")
 *   WORK_DIR            scratch dir for downloads (default os.tmpdir())
 *
 * Prereqs:
 *   • `pnpm install` from repo root (adds pg)
 *   • migrations 20260601000300 + 20260601000310 applied (see their headers —
 *     Studio SQL + manual schema_migrations reconcile, NOT `db push`).
 *
 * The SAL→GNAF match is the documented HOR-369 risk: we join on uppercased
 * locality name + state. Unmatched SAL localities are LOGGED, never silently
 * dropped — review the tail of the run before trusting a load.
 */

import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { readFile, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { request as httpsRequest } from 'node:https'
import { URL } from 'node:url'

import pg from 'pg'

const { Client } = pg

// ────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────

const SOURCE = 'ABS_ASGS_2021_SAL'

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')

const DB_URL = process.env.SUPABASE_DB_URL
const GEOJSON_PATH = process.env.SAL_GEOJSON_PATH
const GEOJSON_URL = process.env.SAL_GEOJSON_URL
const STATES = (process.env.SAL_STATES?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)) || ['QLD']
const TOLERANCE = Number(process.env.SIMPLIFY_TOLERANCE ?? 0.0005)
const SOURCE_VERSION = process.env.SAL_SOURCE_VERSION || 'GDA2020'
const WORK_DIR = process.env.WORK_DIR || join(tmpdir(), 'sal-ingest')

// Spot-check suburbs from the design (screen 02). We assert these matched.
const SPOT_CHECK = ['NEW FARM', 'PADDINGTON', 'TENERIFFE', 'WEST END']

// ABS state names → abbrev, for tolerant filtering on either field.
const STATE_NAME_TO_ABBREV = {
  'NEW SOUTH WALES': 'NSW', 'VICTORIA': 'VIC', 'QUEENSLAND': 'QLD',
  'SOUTH AUSTRALIA': 'SA', 'WESTERN AUSTRALIA': 'WA', 'TASMANIA': 'TAS',
  'NORTHERN TERRITORY': 'NT', 'AUSTRALIAN CAPITAL TERRITORY': 'ACT',
  'OTHER TERRITORIES': 'OT',
}

if (!DB_URL) fatal('SUPABASE_DB_URL is required')
if (!GEOJSON_PATH && !GEOJSON_URL) fatal('Set SAL_GEOJSON_PATH (or SAL_GEOJSON_URL)')

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
 * (Mirrors scripts/gnaf/ingest.mjs.)
 * @param {string} url @param {string} destPath @param {number} [hops]
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
      headers: { 'User-Agent': 'horace-sal-ingest' },
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
      pipeline(res, createWriteStream(destPath)).then(resolve, reject)
    })
    req.on('error', reject)
    req.end()
  })
}

/**
 * Read SAL `properties` tolerantly across ABS field-naming variants
 * (SAL_NAME21 / SAL_NAME_2021, STE_NAME21 / STATE_NAME_2021, etc.).
 * @param {Record<string, unknown>} props
 */
function readFeatureProps(props) {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = props[k]
      if (v != null && String(v).length > 0) return String(v)
    }
    return null
  }
  const rawName = pick('SAL_NAME21', 'SAL_NAME_2021', 'SAL_NAME', 'sal_name21')
  const stateName = pick('STE_NAME21', 'STATE_NAME_2021', 'STE_NAME', 'ste_name21')
  const stateCode = pick('STE_CODE21', 'STATE_CODE_2021', 'STE_CODE', 'ste_code21')
  return { rawName, stateName, stateCode }
}

/**
 * Canonicalise a SAL name for the GNAF join: drop a trailing state
 * parenthetical (ABS appends "(Qld)" etc. to disambiguate cross-state
 * duplicates), collapse whitespace, uppercase. GNAF stores names like
 * "NEW FARM"; get_suburb_signals joins case-insensitively.
 * @param {string} raw
 */
function normaliseName(raw) {
  return raw.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim().toUpperCase()
}

/** Resolve a feature's state abbrev from either the name or numeric code. */
function resolveStateAbbrev(stateName, stateCode) {
  if (stateName) {
    const abbrev = STATE_NAME_TO_ABBREV[stateName.trim().toUpperCase()]
    if (abbrev) return abbrev
  }
  // ABS STE codes: 1 NSW, 2 VIC, 3 QLD, 4 SA, 5 WA, 6 TAS, 7 NT, 8 ACT, 9 OT.
  const byCode = { '1': 'NSW', '2': 'VIC', '3': 'QLD', '4': 'SA', '5': 'WA', '6': 'TAS', '7': 'NT', '8': 'ACT', '9': 'OT' }
  return stateCode ? (byCode[stateCode.trim()] ?? null) : null
}

// ── Douglas–Peucker on a ring of [lng,lat] positions ────────────────
// Perpendicular distance is computed in raw degree space. That's a slight
// anisotropy (a degree of lng is shorter than lat away from the equator) but
// at QLD latitudes (~-16 to -29°) and a ~50m tolerance it's immaterial for a
// web-render simplification. Endpoints are always kept.

/** @param {number[]} p @param {number[]} a @param {number[]} b */
function perpDist(p, a, b) {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** @param {number[][]} pts @param {number} eps @returns {number[][]} */
function douglasPeucker(pts, eps) {
  if (pts.length < 3) return pts
  let maxDist = 0, idx = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1])
    if (d > maxDist) { maxDist = d; idx = i }
  }
  if (maxDist > eps) {
    const left = douglasPeucker(pts.slice(0, idx + 1), eps)
    const right = douglasPeucker(pts.slice(idx), eps)
    return left.slice(0, -1).concat(right)
  }
  return [pts[0], pts[pts.length - 1]]
}

/**
 * Simplify a closed ring, preserving closure. Returns null if the ring
 * collapses below the 4 positions a valid GeoJSON LinearRing needs.
 * @param {number[][]} ring @param {number} eps
 */
function simplifyRing(ring, eps) {
  const simplified = douglasPeucker(ring, eps)
  // Re-close if DP dropped the duplicate closing vertex.
  const first = simplified[0], last = simplified[simplified.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) simplified.push([first[0], first[1]])
  return simplified.length >= 4 ? simplified : null
}

/**
 * Simplify a GeoJSON Polygon/MultiPolygon geometry in place-ish (returns a new
 * geometry). Outer + inner rings simplified independently; a ring that
 * collapses is dropped (an inner hole) or — if it's the outer ring — drops the
 * whole polygon part.
 * @param {{type: string, coordinates: any}} geom @param {number} eps
 */
function simplifyGeometry(geom, eps) {
  if (geom.type === 'Polygon') {
    const rings = geom.coordinates.map((r) => simplifyRing(r, eps)).filter(Boolean)
    return rings.length ? { type: 'Polygon', coordinates: rings } : null
  }
  if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates
      .map((poly) => poly.map((r) => simplifyRing(r, eps)).filter(Boolean))
      .filter((poly) => poly.length > 0)
    return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null
  }
  return null
}

/** Count positions in a Polygon/MultiPolygon (for the size-reduction stat). */
function countPositions(geom) {
  if (geom.type === 'Polygon') return geom.coordinates.reduce((n, r) => n + r.length, 0)
  if (geom.type === 'MultiPolygon') return geom.coordinates.reduce((n, p) => n + p.reduce((m, r) => m + r.length, 0), 0)
  return 0
}

/**
 * Area-weighted centroid fallback (shoelace on the largest outer ring) when the
 * matched GNAF locality has no centroid. [lng, lat].
 * @param {{type: string, coordinates: any}} geom
 */
function polygonCentroid(geom) {
  const rings = geom.type === 'Polygon'
    ? [geom.coordinates[0]]
    : geom.coordinates.map((p) => p[0])
  let best = null, bestArea = -1
  for (const ring of rings) {
    let area = 0, cx = 0, cy = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i], [x1, y1] = ring[i + 1]
      const cross = x0 * y1 - x1 * y0
      area += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross
    }
    area *= 0.5
    if (Math.abs(area) > bestArea) {
      bestArea = Math.abs(area)
      best = area === 0 ? null : [cx / (6 * area), cy / (6 * area)]
    }
  }
  return best
}

// ────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────

async function main() {
  log(`SAL ingest starting — states=${STATES.join(',')}, tolerance=${TOLERANCE}, dry-run=${DRY_RUN}`)

  // ── 1. Acquire the GeoJSON ─────────────────────────────────────────
  let geojsonPath = GEOJSON_PATH
  if (!geojsonPath) {
    geojsonPath = join(WORK_DIR, 'sal.geojson')
    if (existsSync(geojsonPath) && (await stat(geojsonPath)).size > 0) {
      log(`reusing ${geojsonPath} (delete to force re-download)`)
    } else {
      log(`downloading ${GEOJSON_URL} → ${geojsonPath}`)
      await downloadTo(GEOJSON_URL, geojsonPath)
    }
  }
  if (!existsSync(geojsonPath)) fatal(`GeoJSON not found at ${geojsonPath}`)

  log(`reading ${geojsonPath}`)
  const fc = JSON.parse(await readFile(geojsonPath, 'utf8'))
  const features = Array.isArray(fc.features) ? fc.features : []
  log(`${features.length.toLocaleString()} features in collection`)

  // ── 2. Connect ─────────────────────────────────────────────────────
  const client = new Client({ connectionString: DB_URL, statement_timeout: 0 })
  await client.connect()
  await client.query(`SET statement_timeout = '10min'`)

  let inState = 0, matched = 0, written = 0, droppedGeom = 0
  const unmatched = []         // { name, state }
  const spotResults = {}       // name → locality_pid | null
  let posBefore = 0, posAfter = 0

  try {
    for (const f of features) {
      if (!f?.geometry || !f.properties) continue
      const { rawName, stateName, stateCode } = readFeatureProps(f.properties)
      if (!rawName) continue
      const stateAbbrev = resolveStateAbbrev(stateName, stateCode)
      if (!stateAbbrev || !STATES.includes(stateAbbrev)) continue
      inState++

      const name = normaliseName(rawName)

      // Simplify before storing.
      posBefore += countPositions(f.geometry)
      const simplified = simplifyGeometry(f.geometry, TOLERANCE)
      if (!simplified) { droppedGeom++; log(`  geometry collapsed at tolerance: ${name} (${stateAbbrev})`); continue }
      posAfter += countPositions(simplified)

      // Match to the GNAF locality_pid get_suburb_signals would emit.
      const { rows } = await client.query(
        `select locality_pid, latitude, longitude
           from gnaf.localities
          where upper(locality_name) = $1 and state_abbrev = $2`,
        [name, stateAbbrev],
      )

      if (SPOT_CHECK.includes(name)) spotResults[name] = rows[0]?.locality_pid ?? null

      if (rows.length === 0) {
        unmatched.push({ name, state: stateAbbrev })
        continue
      }
      if (rows.length > 1) {
        log(`  ambiguous match: ${name} (${stateAbbrev}) → ${rows.length} GNAF localities; using ${rows[0].locality_pid}`)
      }
      matched++

      const loc = rows[0]
      let lat = loc.latitude != null ? Number(loc.latitude) : null
      let lng = loc.longitude != null ? Number(loc.longitude) : null
      if (lat == null || lng == null) {
        const c = polygonCentroid(simplified)
        if (c) { lng = lng ?? c[0]; lat = lat ?? c[1] }
      }

      if (DRY_RUN) { written++; continue }

      await client.query(
        `insert into public.suburb_boundaries
           (locality_key, locality_name, state_abbrev, boundary_geojson,
            centroid_lat, centroid_lng, source, source_version, loaded_at)
         values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, now())
         on conflict (locality_key) do update set
           locality_name    = excluded.locality_name,
           state_abbrev     = excluded.state_abbrev,
           boundary_geojson = excluded.boundary_geojson,
           centroid_lat     = excluded.centroid_lat,
           centroid_lng     = excluded.centroid_lng,
           source           = excluded.source,
           source_version   = excluded.source_version,
           loaded_at        = now()`,
        [loc.locality_pid, name, stateAbbrev, JSON.stringify(simplified), lat, lng, SOURCE, SOURCE_VERSION],
      )
      written++
    }

    // ── 3. Report ────────────────────────────────────────────────────
    log('─'.repeat(60))
    log(`in-scope features (${STATES.join(',')}): ${inState.toLocaleString()}`)
    log(`matched to GNAF locality_pid:           ${matched.toLocaleString()}`)
    log(`${DRY_RUN ? 'would write' : 'written'} to suburb_boundaries:   ${written.toLocaleString()}`)
    if (droppedGeom) log(`geometry collapsed at tolerance:        ${droppedGeom}`)
    if (posBefore) {
      const pct = (100 * (1 - posAfter / posBefore)).toFixed(1)
      log(`vertices: ${posBefore.toLocaleString()} → ${posAfter.toLocaleString()} (−${pct}% after simplify)`)
    }

    // Spot-checks from the design — fail loudly if a known suburb didn't match.
    log('spot-checks (design screen 02):')
    let spotFail = false
    for (const s of SPOT_CHECK) {
      const pid = spotResults[s]
      log(`  ${s}: ${pid ? `matched → ${pid}` : 'NO MATCH'}`)
      if (!pid) spotFail = true
    }

    // Unmatched localities — logged, never silently dropped (HOR-369 AC).
    if (unmatched.length) {
      log(`unmatched SAL localities (${unmatched.length}) — review before trusting this load:`)
      for (const u of unmatched) log(`  · ${u.name} (${u.state})`)
    } else {
      log('unmatched SAL localities: none')
    }

    if (spotFail) {
      fatal('one or more design spot-check suburbs did not match a GNAF locality — investigate name/state join before relying on this load')
    }
    log(DRY_RUN ? 'dry-run complete — no rows written.' : 'done.')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
