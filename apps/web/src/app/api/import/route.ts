import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseRexCsv } from '@/lib/crm/rex-parser'

export async function POST(request: NextRequest) {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Get agent record for this user
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .not('workspace_id', 'is', null)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'No agent found' }, { status: 400 })
  const agentId = agent.id

  // Parse multipart form
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  }

  const filename = (file as File).name
  const csvText = await (file as File).text()

  // Parse CSV
  const { contacts, skipped: parseSkipped, errors: parseErrors } = parseRexCsv(csvText)

  if (contacts.length === 0) {
    return NextResponse.json(
      { error: 'No valid contacts found in CSV', parseErrors },
      { status: 422 },
    )
  }

  // Create import record
  const { data: importRecord } = await admin
    .from('crm_imports')
    .insert({
      agent_id: agentId,
      source: 'rex',
      filename,
      row_count: contacts.length + parseSkipped,
      status: 'processing',
    })
    .select('id')
    .single()

  const importId = importRecord?.id

  let createdCount = 0
  let matchedCount = 0
  let skippedCount = parseSkipped

  // Upsert contacts in batches of 100
  const BATCH = 100
  for (let i = 0; i < contacts.length; i += BATCH) {
    const batch = contacts.slice(i, i + BATCH)

    const rows = batch.map((c) => ({
      agent_id: agentId,
      email: c.email,
      first_name: c.first_name,
      last_name: c.last_name,
      phone: c.phone,
      crm_source: 'rex' as const,
      crm_external_id: c.crm_external_id,
      ...(c.email ? { identified_at: new Date().toISOString() } : {}),
    }))

    // Contacts with email: upsert on (agent_id, email)
    const withEmail = rows.filter((r) => r.email)
    const withoutEmail = rows.filter((r) => !r.email)

    if (withEmail.length > 0) {
      const { data, error } = await admin
        .from('contacts')
        .upsert(withEmail, { onConflict: 'agent_id,email', ignoreDuplicates: false })
        .select('id, created_at')

      if (!error && data) {
        const now = Date.now()
        for (const row of data) {
          const createdAt = new Date(row.created_at).getTime()
          // Created within the last 10s = new
          if (now - createdAt < 10_000) createdCount++
          else matchedCount++
        }
      }
    }

    // Contacts without email: always insert (can't deduplicate without email)
    if (withoutEmail.length > 0) {
      const { data } = await admin
        .from('contacts')
        .insert(withoutEmail)
        .select('id')

      createdCount += data?.length ?? 0
    }
  }

  // Update import record with final counts
  if (importId) {
    await admin
      .from('crm_imports')
      .update({
        status: 'done',
        created_count: createdCount,
        matched_count: matchedCount,
        skipped_count: skippedCount,
      })
      .eq('id', importId)
  }

  return NextResponse.json({
    ok: true,
    created: createdCount,
    matched: matchedCount,
    skipped: skippedCount,
    total: contacts.length + skippedCount,
  })
}
