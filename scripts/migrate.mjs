#!/usr/bin/env node
// Migration runner — uses Supabase Management API to execute SQL files in order.
// Usage: SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/migrate.mjs

import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF

if (!ACCESS_TOKEN) {
  console.error('Error: SUPABASE_ACCESS_TOKEN env var required.')
  console.error('Get yours at: https://supabase.com/dashboard/account/tokens')
  process.exit(1)
}

if (!PROJECT_REF) {
  console.error('Error: SUPABASE_PROJECT_REF env var required (e.g. mgyivfyaubefpouxnwad)')
  process.exit(1)
}

async function runQuery(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API error ${res.status}: ${text}`)
  }

  return res.json()
}

async function main() {
  const migrationsDir = join(__dirname, '..', 'packages', 'db', 'migrations')
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  console.log(`Running ${files.length} migration(s)...\n`)

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8')
    process.stdout.write(`  ${file} ... `)
    try {
      await runQuery(sql)
      console.log('OK')
    } catch (err) {
      console.log('FAILED')
      console.error(`\n${err.message}\n`)
      process.exit(1)
    }
  }

  console.log('\nAll migrations applied successfully.')
}

main()
