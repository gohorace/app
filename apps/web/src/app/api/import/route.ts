import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseCsv, type FieldMapping } from '@/lib/crm/csv-parser'

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

  // Optional explicit field mapping from the preview/confirm step
  const mappingRaw = formData.get('mapping')
  let mapping: FieldMapping | undefined
  if (typeof mappingRaw === 'string' && mappingRaw.trim().length > 0) {
    try {
      const parsed = JSON.parse(mappingRaw)
      if (parsed && typeof parsed === 'object') mapping = parsed as FieldMapping
    } catch {
      return NextResponse.json({ error: 'Invalid mapping JSON' }, { status: 400 })
    }
  }

  // Parse CSV
  const { contacts, skipped: parseSkipped, errors: parseErrors } = parseCsv(csvText, mapping)

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
      source: 'manual',
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

  const now = new Date().toISOString()

  // ── Contacts WITH email ──────────────────────────────────────────────────
  // Deduplicate by email (the CSV can contain the same email twice).
  const emailMap = new Map<string, typeof contacts[number]>()
  for (const c of contacts) {
    if (c.email) emailMap.set(c.email, c)
  }
  const withEmail = [...emailMap.values()]

  if (withEmail.length > 0) {
    const allEmails = withEmail.map((c) => c.email as string)

    // Find which emails already exist so we can split insert vs update.
    const { data: existing, error: lookupError } = await admin
      .from('contacts')
      .select('id, email')
      .eq('agent_id', agentId)
      .in('email', allEmails)

    if (lookupError) {
      return NextResponse.json({ error: `Lookup failed: ${lookupError.message}` }, { status: 500 })
    }

    const existingByEmail = new Map((existing ?? []).map((r) => [r.email, r.id]))

    const toInsert = withEmail.filter((c) => !existingByEmail.has(c.email as string))
    const toUpdate = withEmail.filter((c) =>  existingByEmail.has(c.email as string))

    if (toInsert.length > 0) {
      const { error } = await admin.from('contacts').insert(
        toInsert.map((c) => ({
          agent_id: agentId,
          email: c.email,
          first_name: c.first_name,
          last_name: c.last_name,
          phone: c.phone,
          source: 'manual' as const,
          crm_external_id: c.crm_external_id,
          identified_at: now,
        })),
      )
      if (error) {
        if (importId) await admin.from('crm_imports').update({ status: 'failed', error_message: error.message }).eq('id', importId)
        return NextResponse.json({ error: `Insert failed: ${error.message}` }, { status: 500 })
      }
      createdCount += toInsert.length
    }

    for (const c of toUpdate) {
      const id = existingByEmail.get(c.email as string)!
      await admin.from('contacts').update({
        first_name: c.first_name,
        last_name: c.last_name,
        phone: c.phone,
        crm_external_id: c.crm_external_id,
        identified_at: now,
      }).eq('id', id)
    }
    matchedCount += toUpdate.length
  }

  // ── Contacts WITHOUT email ───────────────────────────────────────────────
  // Deduplicate by crm_external_id to avoid creating duplicates on re-import.
  const noEmailContacts = contacts.filter((c) => !c.email)

  if (noEmailContacts.length > 0) {
    const extIds = noEmailContacts.map((c) => c.crm_external_id).filter(Boolean) as string[]

    const { data: existingNoEmail } = extIds.length > 0
      ? await admin.from('contacts').select('id, crm_external_id').eq('agent_id', agentId).in('crm_external_id', extIds)
      : { data: [] }

    const existingExtIds = new Set((existingNoEmail ?? []).map((r) => r.crm_external_id))

    const toInsertNoEmail = noEmailContacts.filter(
      (c) => !c.crm_external_id || !existingExtIds.has(c.crm_external_id),
    )
    const toUpdateNoEmail = noEmailContacts.filter(
      (c) => c.crm_external_id && existingExtIds.has(c.crm_external_id),
    )

    if (toInsertNoEmail.length > 0) {
      const { error } = await admin.from('contacts').insert(
        toInsertNoEmail.map((c) => ({
          agent_id: agentId,
          email: null,
          first_name: c.first_name,
          last_name: c.last_name,
          phone: c.phone,
          source: 'manual' as const,
          crm_external_id: c.crm_external_id,
        })),
      )
      if (error) {
        if (importId) await admin.from('crm_imports').update({ status: 'failed', error_message: error.message }).eq('id', importId)
        return NextResponse.json({ error: `Insert failed: ${error.message}` }, { status: 500 })
      }
      createdCount += toInsertNoEmail.length
    }

    for (const c of toUpdateNoEmail) {
      const existing = (existingNoEmail ?? []).find((r) => r.crm_external_id === c.crm_external_id)
      if (existing) {
        await admin.from('contacts').update({
          first_name: c.first_name,
          last_name: c.last_name,
          phone: c.phone,
        }).eq('id', existing.id)
      }
    }
    matchedCount += toUpdateNoEmail.length
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
