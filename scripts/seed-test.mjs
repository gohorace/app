#!/usr/bin/env node
/**
 * Local test seed script.
 *
 * Creates a workspace + agent + test contacts with varied event histories,
 * then runs the weekly briefing cron locally so you can see the full output.
 *
 * Usage:
 *   node scripts/seed-test.mjs
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ANTHROPIC_API_KEY        (optional — skips AI insights if missing)
 *   CRON_SECRET              (optional — defaults to 'test-secret')
 *   NEXT_PUBLIC_APP_URL      (optional — defaults to http://localhost:3000)
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

// ─── Load .env.local ──────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', 'apps', 'web', '.env.local')

try {
  const env = readFileSync(envPath, 'utf-8')
  for (const line of env.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
} catch {
  console.error('Could not read apps/web/.env.local — make sure it exists.')
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP_URL      = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const CRON_SECRET  = process.env.CRON_SECRET ?? 'test-secret'

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ─── Helpers ─────────────────────────────────────────────────────────────────
function ago(days, hours = 0) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(d.getHours() - hours)
  return d.toISOString()
}

function log(msg) { console.log(`  ${msg}`) }
function section(msg) { console.log(`\n▶ ${msg}`) }
function ok(msg) { console.log(`  ✓ ${msg}`) }

async function must(label, promise) {
  const { data, error } = await promise
  if (error) {
    console.error(`  ✗ ${label}: ${error.message}`)
    process.exit(1)
  }
  ok(label)
  return data
}

// ─── 1. Workspace + Agent ─────────────────────────────────────────────────────
section('Workspace + Agent')

// Check if test workspace already exists
const { data: existingWorkspace } = await db
  .from('workspaces')
  .select('id, snippet_key, default_agent_id')
  .eq('slug', 'test-workspace')
  .maybeSingle()

let workspaceId, snippetKey, agentId

if (existingWorkspace) {
  workspaceId = existingWorkspace.id
  snippetKey  = existingWorkspace.snippet_key
  agentId     = existingWorkspace.default_agent_id
  log(`Reusing existing workspace: ${workspaceId}`)
  log(`Snippet key: ${snippetKey}`)
  log(`Agent ID:    ${agentId}`)
} else {
  // Create a real auth user via the Admin API (required for FK constraint)
  const TEST_EMAIL = 'matt-test@maxproperty.au'
  let TEST_USER_ID

  const adminAuthRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({
      email: TEST_EMAIL,
      password: 'test-password-123',
      email_confirm: true,
      user_metadata: { full_name: 'Matt Test' },
    }),
  })

  if (adminAuthRes.ok) {
    const authUser = await adminAuthRes.json()
    TEST_USER_ID = authUser.id
    ok(`Auth user created: ${TEST_USER_ID}`)
  } else {
    // User likely already exists — find them
    const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(TEST_EMAIL)}`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
    })
    const list = await listRes.json()
    const existing = list.users?.find(u => u.email === TEST_EMAIL)
    if (!existing) {
      console.error('  ✗ Could not create or find test auth user')
      process.exit(1)
    }
    TEST_USER_ID = existing.id
    log(`Reusing auth user: ${TEST_USER_ID}`)
  }

  const result = await must('create_workspace_with_agent RPC', db.rpc('create_workspace_with_agent', {
    p_user_id:    TEST_USER_ID,
    p_name:       'Test Workspace',
    p_slug:       'test-workspace',
    p_email:      TEST_EMAIL,
    p_first_name: 'Matt',
    p_last_name:  'Test',
  }))

  workspaceId = result[0].workspace_id
  agentId     = result[0].agent_id

  const { data: ws } = await db.from('workspaces').select('snippet_key').eq('id', workspaceId).single()
  snippetKey = ws.snippet_key

  // Set agent email for briefing
  await db.from('agent_settings').update({
    agent_email: 'matt@maxproperty.au',
    weekly_briefing_day: new Date().getDay(), // today so the cron fires
  }).eq('agent_id', agentId)

  log(`Workspace ID: ${workspaceId}`)
  log(`Snippet key:  ${snippetKey}`)
  log(`Agent ID:     ${agentId}`)
}

// Ensure briefing day is set to today (in case it was seeded before)
await db.from('agent_settings').update({
  weekly_briefing_day: new Date().getDay(),
  agent_email: 'matt@maxproperty.au',
}).eq('agent_id', agentId)

// ─── 2. Test Contacts ─────────────────────────────────────────────────────────
section('Contacts')

const contactDefs = [
  {
    first_name: 'Sarah',
    last_name:  'Mitchell',
    email:      'sarah.mitchell@example.com',
    phone:      '+61400111222',
    crm_source: 'rex',
    label:      'High intent — appraisal + return visit',
  },
  {
    first_name: 'David',
    last_name:  'Chen',
    email:      'david.chen@example.com',
    phone:      '+61400333444',
    crm_source: 'rex',
    label:      'Warm — campaign click + location views',
  },
  {
    first_name: 'Emma',
    last_name:  'Thompson',
    email:      'emma.thompson@example.com',
    phone:      null,
    crm_source: 'manual',
    label:      'Cold — single page view',
  },
]

const contacts = []
for (const def of contactDefs) {
  const { data: existing } = await db
    .from('contacts')
    .select('id, score')
    .eq('agent_id', agentId)
    .eq('email', def.email)
    .maybeSingle()

  if (existing) {
    log(`Reusing contact: ${def.first_name} ${def.last_name} (score: ${existing.score})`)
    contacts.push({ ...existing, ...def })
  } else {
    const { data: c, error } = await db.from('contacts').insert({
      agent_id:   agentId,
      first_name: def.first_name,
      last_name:  def.last_name,
      email:      def.email,
      phone:      def.phone,
      crm_source: def.crm_source,
      score:      0,
    }).select('id, score').single()

    if (error) {
      console.error(`  ✗ Contact ${def.email}: ${error.message}`)
      process.exit(1)
    }
    ok(`Created: ${def.first_name} ${def.last_name} — ${def.label}`)
    contacts.push({ ...c, ...def })
  }
}

// ─── 3. Sessions + Events + Identity Map ─────────────────────────────────────
section('Sessions, Events, Identity Map')

async function seedSession(anonId) {
  const { data: existing } = await db
    .from('sessions')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('anonymous_id', anonId)
    .maybeSingle()

  if (existing) return existing.id

  const { data, error } = await db.from('sessions').insert({
    workspace_id: workspaceId,
    anonymous_id: anonId,
    first_seen_at: ago(7),
    last_seen_at:  ago(0),
  }).select('id').single()

  if (error) { console.error(`Session error: ${error.message}`); process.exit(1) }
  return data.id
}

async function seedIdentityMap(anonId, contactId, method = 'form') {
  const { error } = await db.from('identity_map').upsert({
    workspace_id:  workspaceId,
    agent_id:      agentId,
    anonymous_id:  anonId,
    contact_id:    contactId,
    stitch_method: method,
    confidence:    'high',
  }, { onConflict: 'workspace_id,agent_id,anonymous_id', ignoreDuplicates: true })

  if (error) console.warn(`  identity_map upsert: ${error.message}`)
}

async function seedEvents(sessionId, eventRows) {
  // Only insert if no events exist for this session
  const { count } = await db
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId)

  if (count > 0) {
    log(`Events already exist for session ${sessionId.slice(0, 8)}… — skipping`)
    return
  }

  const { error } = await db.from('events').insert(
    eventRows.map(e => ({ ...e, workspace_id: workspaceId, session_id: sessionId }))
  )
  if (error) { console.error(`Events error: ${error.message}`); process.exit(1) }
}

// Sarah — appraisal form submit + return visit (high intent)
const sarahAnon = 'anon-sarah-001'
const sarahSession = await seedSession(sarahAnon)
await seedEvents(sarahSession, [
  { event_type: 'page_view',    properties: { path: '/noosaville' },           score_delta: 0, occurred_at: ago(5) },
  { event_type: 'page_view',    properties: { path: '/appraisal' },             score_delta: 0, occurred_at: ago(5) },
  { event_type: 'form_submit',  properties: { form_id: 'appraisal-form', path: '/appraisal' }, score_delta: 0, occurred_at: ago(5) },
  { event_type: 'return_visit', properties: { path: '/noosaville' },           score_delta: 0, occurred_at: ago(2) },
  { event_type: 'page_view',    properties: { path: '/properties/14-surf-parade' }, score_delta: 0, occurred_at: ago(2) },
  { event_type: 'scroll_depth', properties: { pct: 95, path: '/noosaville' }, score_delta: 0, occurred_at: ago(2) },
])
await seedIdentityMap(sarahAnon, contacts[0].id, 'form')
ok(`Sarah: 6 events seeded`)

// David — campaign click + location views (warm)
const davidAnon = 'anon-david-001'
const davidSession = await seedSession(davidAnon)
await seedEvents(davidSession, [
  { event_type: 'campaign_click', properties: { campaign: 'noosaville-seller-q4' }, score_delta: 0, occurred_at: ago(4) },
  { event_type: 'page_view',     properties: { path: '/noosaville' },              score_delta: 0, occurred_at: ago(4) },
  { event_type: 'property_view', properties: { address: '7 Thomas Street, Noosaville' }, score_delta: 0, occurred_at: ago(4) },
  { event_type: 'property_view', properties: { address: '12 Eenie Creek Rd, Noosaville' }, score_delta: 0, occurred_at: ago(3) },
  { event_type: 'scroll_depth',  properties: { pct: 92, path: '/noosaville' },    score_delta: 0, occurred_at: ago(3) },
])
await seedIdentityMap(davidAnon, contacts[1].id, 'email_click')
ok(`David: 5 events seeded`)

// Emma — minimal activity (cold)
const emmaAnon = 'anon-emma-001'
const emmaSession = await seedSession(emmaAnon)
await seedEvents(emmaSession, [
  { event_type: 'page_view', properties: { path: '/' }, score_delta: 0, occurred_at: ago(6) },
])
await seedIdentityMap(emmaAnon, contacts[2].id, 'manual')
ok(`Emma: 1 event seeded`)

// ─── 4. Score all contacts ────────────────────────────────────────────────────
section('Scoring')

async function scoreContact(contact, anonId, sessionId) {
  const { data: events } = await db
    .from('events')
    .select('id, session_id, event_type, properties, occurred_at')
    .eq('session_id', sessionId)
    .eq('score_delta', 0)
    .order('occurred_at', { ascending: true })

  if (!events?.length) {
    log(`${contact.first_name}: no unscored events`)
    return
  }

  const { data: settings } = await db
    .from('agent_settings')
    .select('scoring_config')
    .eq('agent_id', agentId)
    .single()

  const overrides = settings?.scoring_config ?? {}

  // V1 rules (matches rules.ts)
  const RULES = [
    { event_type: 'page_view',      points: 1,  max_per_session: 5  },
    { event_type: 'property_view',  points: 5,  max_per_session: 10 },
    { event_type: 'form_submit',    points: 50, max_per_session: 1  },
    { event_type: 'scroll_depth',   points: 2,  conditions: { pct_gte: 90 }, max_per_session: 1 },
    { event_type: 'return_visit',   points: 30, max_per_session: 1  },
    { event_type: 'campaign_click', points: 25, max_per_session: 1  },
  ]

  const rules = RULES.map(r => {
    const o = overrides[r.event_type]
    return o ? { ...r, ...o } : r
  })

  // Per-session cap
  const counts = {}
  for (const e of events) {
    counts[e.event_type] = (counts[e.event_type] ?? 0) + 1
  }

  let delta = 0
  const applied = []

  for (const rule of rules) {
    let count = counts[rule.event_type] ?? 0
    if (count === 0) continue

    if (rule.conditions?.pct_gte !== undefined) {
      count = events.filter(e =>
        e.event_type === rule.event_type &&
        typeof e.properties?.pct === 'number' &&
        e.properties.pct >= rule.conditions.pct_gte
      ).length
    }

    const capped = rule.max_per_session != null ? Math.min(count, rule.max_per_session) : count
    if (capped > 0) {
      delta += rule.points * capped
      applied.push(`${rule.event_type}×${capped}=${rule.points * capped}`)
    }
  }

  if (delta === 0) {
    log(`${contact.first_name}: no scoreable events`)
    return
  }

  const scoreBefore = contact.score ?? 0
  const scoreAfter  = scoreBefore + delta

  await db.from('contacts').update({ score: scoreAfter, identified_at: ago(5), last_seen_at: ago(0) }).eq('id', contact.id)
  await db.from('score_history').insert({
    agent_id:    agentId,
    contact_id:  contact.id,
    delta,
    reason:      applied.join(', '),
    score_before: scoreBefore,
    score_after:  scoreAfter,
  })
  await db.from('events').update({ score_delta: 1 }).eq('session_id', sessionId).eq('score_delta', 0)

  ok(`${contact.first_name}: ${scoreBefore} → ${scoreAfter} (${applied.join(', ')})`)
}

const sessions = [sarahSession, davidSession, emmaSession]
for (let i = 0; i < contacts.length; i++) {
  await scoreContact(contacts[i], null, sessions[i])
}

// ─── 5. Trigger weekly briefing ───────────────────────────────────────────────
section('Weekly Briefing')

const briefingUrl = `${APP_URL}/api/cron/weekly-briefing`
log(`POST ${briefingUrl}`)

try {
  const res = await fetch(briefingUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  })
  const body = await res.json()

  if (!res.ok) {
    console.error(`  ✗ Briefing endpoint returned ${res.status}:`, body)
  } else if (body.skipped) {
    log('Briefing skipped — Resend or Anthropic not configured')
    log('This is expected locally. Check the cron output in your Next.js terminal.')
  } else {
    ok(`Briefing sent: ${body.sent} email(s)`)
    if (body.errors?.length) log(`Errors: ${body.errors.join(', ')}`)
  }
} catch (err) {
  console.error(`  ✗ Could not reach ${briefingUrl}`)
  console.error(`    Is the Next.js dev server running? (pnpm dev)`)
  console.error(`    ${err.message}`)
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Seed complete

Workspace snippet key: ${snippetKey}
Agent ID:             ${agentId}

Test contacts:
  sarah.mitchell@example.com  — appraisal submit + return visit
  david.chen@example.com      — campaign click + property views
  emma.thompson@example.com   — cold (single page view)

To re-run the briefing manually:
  curl -s -H "Authorization: Bearer ${CRON_SECRET}" \\
    ${APP_URL}/api/cron/weekly-briefing | jq

To test the tracker snippet:
  k="${snippetKey}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
