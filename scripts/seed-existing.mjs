#!/usr/bin/env node
/**
 * Seed Sarah / David / Emma under an existing Horace user's agent.
 *
 * Use when the user signed up via the dashboard and wants demo data
 * without creating the parallel test-workspace that seed-test.mjs makes.
 *
 * Idempotent: re-running updates existing rows rather than duplicating.
 *
 * Usage:
 *   node scripts/seed-existing.mjs <email>
 *   node scripts/seed-existing.mjs matt-test@maxproperty.au
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

// ─── Load apps/web/.env.local ────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', 'apps', 'web', '.env.local')
try {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (!process.env[k]) process.env[k] = v
  }
} catch {
  console.error('Could not read apps/web/.env.local')
  process.exit(1)
}

const email = process.argv[2]
if (!email) {
  console.error('Usage: node scripts/seed-existing.mjs <email>')
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ─── Find user + agent ───────────────────────────────────────────────────────
const userListRes = await fetch(
  `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
  { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
)
const userList = await userListRes.json()
const user = userList.users?.find((u) => u.email === email)
if (!user) {
  console.error(`✗ Auth user not found: ${email}`)
  process.exit(1)
}
console.log(`✓ User:      ${user.id}`)

const { data: agents } = await db
  .from('agents')
  .select('id, workspace_id')
  .eq('user_id', user.id)
  .not('workspace_id', 'is', null)

if (!agents || agents.length === 0) {
  console.error(`✗ No agent with a workspace for ${email}. Sign up via the dashboard first.`)
  process.exit(1)
}
if (agents.length > 1) {
  console.warn(`! User has ${agents.length} agent rows; using the first.`)
}
const { id: agentId, workspace_id: workspaceId } = agents[0]
console.log(`✓ Agent:     ${agentId}`)
console.log(`✓ Workspace: ${workspaceId}`)

// ─── Helpers ─────────────────────────────────────────────────────────────────
function ago(days, hours = 0) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(d.getHours() - hours)
  return d.toISOString()
}

// ─── Contact definitions (with sessions + events) ───────────────────────────
const contactDefs = [
  {
    email: 'sarah.mitchell@example.com',
    first_name: 'Sarah', last_name: 'Mitchell', phone: '+61400111222',
    crm_source: 'rex', score: 88, identified_at: ago(5), last_seen_at: ago(2),
    label: 'High intent — appraisal + return visit',
    anon: 'anon-sarah-001',
    events: [
      { event_type: 'page_view',    properties: { url: 'https://example.com/noosaville' }, score_delta: 1, occurred_at: ago(5) },
      { event_type: 'page_view',    properties: { url: 'https://example.com/appraisal' }, score_delta: 1, occurred_at: ago(5) },
      { event_type: 'form_submit',  properties: { form_id: 'appraisal-form', url: 'https://example.com/appraisal' }, score_delta: 50, occurred_at: ago(5) },
      { event_type: 'return_visit', properties: { url: 'https://example.com/noosaville' }, score_delta: 30, occurred_at: ago(2) },
      { event_type: 'page_view',    properties: { url: 'https://example.com/properties/14-surf-parade' }, score_delta: 1, occurred_at: ago(2) },
      { event_type: 'scroll_depth', properties: { pct: 95, url: 'https://example.com/noosaville' }, score_delta: 2, occurred_at: ago(2) },
    ],
  },
  {
    email: 'david.chen@example.com',
    first_name: 'David', last_name: 'Chen', phone: '+61400333444',
    crm_source: 'rex', score: 47, identified_at: ago(4), last_seen_at: ago(3),
    label: 'Warm — campaign click + property views',
    anon: 'anon-david-001',
    events: [
      { event_type: 'campaign_click', properties: { campaign: 'noosaville-seller-q4' }, score_delta: 25, occurred_at: ago(4) },
      { event_type: 'page_view',     properties: { url: 'https://example.com/noosaville' }, score_delta: 1, occurred_at: ago(4) },
      { event_type: 'property_view', properties: { address: '7 Thomas Street, Noosaville' }, score_delta: 5, occurred_at: ago(4) },
      { event_type: 'property_view', properties: { address: '12 Eenie Creek Rd, Noosaville' }, score_delta: 5, occurred_at: ago(3) },
      { event_type: 'scroll_depth',  properties: { pct: 92, url: 'https://example.com/noosaville' }, score_delta: 2, occurred_at: ago(3) },
    ],
  },
  {
    email: 'emma.thompson@example.com',
    first_name: 'Emma', last_name: 'Thompson', phone: null,
    crm_source: 'manual', score: 1, identified_at: ago(6), last_seen_at: ago(6),
    label: 'Cold — single page view',
    anon: 'anon-emma-001',
    events: [
      { event_type: 'page_view', properties: { url: 'https://example.com/' }, score_delta: 1, occurred_at: ago(6) },
    ],
  },
]

// ─── Seed ────────────────────────────────────────────────────────────────────
console.log('')
for (const def of contactDefs) {
  // 1. Contact (upsert)
  const { data: existing } = await db
    .from('contacts')
    .select('id')
    .eq('agent_id', agentId)
    .eq('email', def.email)
    .maybeSingle()

  let contactId
  if (existing) {
    await db.from('contacts').update({
      first_name: def.first_name, last_name: def.last_name, phone: def.phone,
      crm_source: def.crm_source, score: def.score,
      identified_at: def.identified_at, last_seen_at: def.last_seen_at,
    }).eq('id', existing.id)
    contactId = existing.id
    console.log(`↻ ${def.first_name} ${def.last_name} — ${def.label} (score ${def.score})`)
  } else {
    const { data: c, error } = await db.from('contacts').insert({
      agent_id: agentId, email: def.email,
      first_name: def.first_name, last_name: def.last_name, phone: def.phone,
      crm_source: def.crm_source, score: def.score,
      identified_at: def.identified_at, last_seen_at: def.last_seen_at,
    }).select('id').single()
    if (error) { console.error(`  contact error: ${error.message}`); process.exit(1) }
    contactId = c.id
    console.log(`✓ ${def.first_name} ${def.last_name} — ${def.label} (score ${def.score})`)
  }

  // 2. Session (upsert by workspace + anonymous_id)
  const { data: existingSession } = await db
    .from('sessions')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('anonymous_id', def.anon)
    .maybeSingle()

  let sessionId = existingSession?.id
  if (!sessionId) {
    const { data: s, error } = await db.from('sessions').insert({
      workspace_id: workspaceId, anonymous_id: def.anon,
      first_seen_at: ago(7), last_seen_at: ago(0),
    }).select('id').single()
    if (error) { console.error(`  session error: ${error.message}`); process.exit(1) }
    sessionId = s.id
  }

  // 3. identity_map
  await db.from('identity_map').upsert({
    workspace_id: workspaceId, agent_id: agentId,
    anonymous_id: def.anon, contact_id: contactId,
    stitch_method: 'form', confidence: 'high',
  }, { onConflict: 'workspace_id,agent_id,anonymous_id', ignoreDuplicates: true })

  // 4. Events (only if session has none)
  const { count } = await db
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId)

  if ((count ?? 0) === 0) {
    await db.from('events').insert(
      def.events.map((e) => ({ ...e, workspace_id: workspaceId, session_id: sessionId })),
    )
  }
}

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Seed complete for ${email}
  3 contacts under agent ${agentId}
  Try \`list_contacts\` again in Claude.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
