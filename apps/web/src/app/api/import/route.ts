import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseCsv, type FieldMapping, type CsvContact } from '@/lib/crm/csv-parser'

/**
 * CSV import — V1 brief alignment (HOR-107 Phase 2c).
 *
 * Behaviour:
 *   - At least one of email or phone is required per row; others skip with
 *     `missing_email_and_phone` reason (enforced in the parser).
 *   - Email is primary dedup key within the importing agent; phone is the
 *     secondary key for rows without email. External CRM id remains as a
 *     stable fallback to avoid duplicate-creating noisy CRM re-exports.
 *   - Phone normalised to E.164 (AU default) in the parser. Unparseable
 *     numbers fall through with the raw value and bump `phone_unparseable`.
 *   - Single-column "Name" → full_name_raw. Structured first/last preferred.
 *   - Single-line address → resolved via resolve_residence_property RPC with
 *     raw fallback. Structured columns resolved with full components.
 *   - ingestion_method = 'csv_import' on every row.
 *   - Soft-deleted contacts are NOT auto-matched: we skip them with a
 *     `matches_soft_deleted_contact` reason so the agent can restore via
 *     the dedicated endpoint.
 *
 * Returns an enriched summary so the UI can show per-reason skips and the
 * count of properties auto-created from the address columns.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user.id)
    .not('workspace_id', 'is', null)
    .maybeSingle()

  if (!agent || !agent.workspace_id) {
    return NextResponse.json({ error: 'No agent found' }, { status: 400 })
  }
  const agentId = agent.id
  const workspaceId = agent.workspace_id

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

  const {
    contacts,
    skipped: parseSkipped,
    skipReasons: parseSkipReasons,
    errors: parseErrors,
  } = parseCsv(csvText, mapping)

  if (contacts.length === 0) {
    return NextResponse.json(
      { error: 'No valid contacts found in CSV', parseErrors, skipReasons: parseSkipReasons },
      { status: 422 },
    )
  }

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
  let phoneUnparseableCount = 0
  const skipReasons: Record<string, number> = { ...parseSkipReasons }
  const noteSkip = (reason: string) => {
    skippedCount++
    skipReasons[reason] = (skipReasons[reason] ?? 0) + 1
  }

  const now = new Date().toISOString()

  // ── Resolve residence_property_id per row when address data is present ────
  const propertyIdByIndex = new Map<number, string>()

  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i]
    if (c.phone_unparseable) phoneUnparseableCount++

    const hasAnyAddress =
      c.street !== null ||
      c.suburb !== null ||
      c.state !== null ||
      c.postcode !== null ||
      c.address_raw !== null

    if (!hasAnyAddress) continue

    const { data: propertyId, error: resolveErr } = await admin.rpc(
      'resolve_residence_property',
      {
        p_workspace_id:  workspaceId,
        p_street_number: null,
        p_street_name:   c.street,
        p_suburb:        c.suburb,
        p_state:         c.state,
        p_postcode:      c.postcode,
        p_raw:           c.address_raw,
      },
    )

    if (resolveErr) {
      console.error('[import] resolve_residence_property error:', resolveErr)
      continue
    }
    if (propertyId) {
      propertyIdByIndex.set(i, propertyId as unknown as string)
    }
  }
  const propertiesTouched = new Set(propertyIdByIndex.values()).size

  // ── Contacts WITH email ────────────────────────────────────────────────────
  const emailMap = new Map<string, { index: number; contact: CsvContact }>()
  for (let i = 0; i < contacts.length; i++) {
    if (contacts[i].email) emailMap.set(contacts[i].email as string, { index: i, contact: contacts[i] })
  }
  const withEmail = [...emailMap.values()]

  if (withEmail.length > 0) {
    const allEmails = withEmail.map(({ contact }) => contact.email as string)

    const { data: existing, error: lookupError } = await admin
      .from('contacts')
      .select('id, email, deleted_at')
      .eq('agent_id', agentId)
      .in('email', allEmails)

    if (lookupError) {
      if (importId) {
        await admin
          .from('crm_imports')
          .update({ status: 'failed', error_message: lookupError.message })
          .eq('id', importId)
      }
      return NextResponse.json({ error: `Lookup failed: ${lookupError.message}` }, { status: 500 })
    }

    const existingByEmail = new Map((existing ?? []).map((r) => [r.email, r]))

    const toInsert: typeof withEmail = []
    const toUpdate: typeof withEmail = []
    for (const entry of withEmail) {
      const match = existingByEmail.get(entry.contact.email as string)
      if (!match) {
        toInsert.push(entry)
      } else if (match.deleted_at) {
        noteSkip('matches_soft_deleted_contact')
      } else {
        toUpdate.push(entry)
      }
    }

    if (toInsert.length > 0) {
      const { error } = await admin.from('contacts').insert(
        toInsert.map(({ index, contact }) => ({
          agent_id: agentId,
          email: contact.email,
          first_name: contact.first_name,
          last_name: contact.last_name,
          full_name_raw: contact.full_name_raw,
          phone: contact.phone,
          source: 'manual' as const,
          ingestion_method: 'csv_import',
          crm_external_id: contact.crm_external_id,
          identified_at: now,
          residence_property_id: propertyIdByIndex.get(index) ?? null,
        })),
      )
      if (error) {
        if (importId) {
          await admin
            .from('crm_imports')
            .update({ status: 'failed', error_message: error.message })
            .eq('id', importId)
        }
        return NextResponse.json({ error: `Insert failed: ${error.message}` }, { status: 500 })
      }
      createdCount += toInsert.length
    }

    for (const { index, contact } of toUpdate) {
      const match = existingByEmail.get(contact.email as string)!
      await admin
        .from('contacts')
        .update({
          first_name: contact.first_name,
          last_name: contact.last_name,
          full_name_raw: contact.full_name_raw,
          phone: contact.phone,
          crm_external_id: contact.crm_external_id,
          ingestion_method: 'csv_import',
          identified_at: now,
          ...(propertyIdByIndex.has(index) && {
            residence_property_id: propertyIdByIndex.get(index),
          }),
        })
        .eq('id', match.id)
      matchedCount++
    }
  }

  // ── Contacts WITHOUT email — match on phone, fall back to crm_external_id ──
  const noEmailEntries = contacts
    .map((c, i) => ({ index: i, contact: c }))
    .filter(({ contact }) => !contact.email)

  if (noEmailEntries.length > 0) {
    const phoneEntries = noEmailEntries.filter(({ contact }) => contact.phone !== null)
    const orphanEntries = noEmailEntries.filter(({ contact }) => contact.phone === null)

    if (phoneEntries.length > 0) {
      const phones = phoneEntries.map(({ contact }) => contact.phone as string)
      const { data: existingByPhone } = await admin
        .from('contacts')
        .select('id, phone, deleted_at')
        .eq('agent_id', agentId)
        .in('phone', phones)

      const matchByPhone = new Map((existingByPhone ?? []).map((r) => [r.phone, r]))

      const phoneToInsert: typeof phoneEntries = []
      const phoneToUpdate: typeof phoneEntries = []
      for (const entry of phoneEntries) {
        const match = matchByPhone.get(entry.contact.phone as string)
        if (!match) {
          phoneToInsert.push(entry)
        } else if (match.deleted_at) {
          noteSkip('matches_soft_deleted_contact')
        } else {
          phoneToUpdate.push(entry)
        }
      }

      if (phoneToInsert.length > 0) {
        const { error } = await admin.from('contacts').insert(
          phoneToInsert.map(({ index, contact }) => ({
            agent_id: agentId,
            email: null,
            first_name: contact.first_name,
            last_name: contact.last_name,
            full_name_raw: contact.full_name_raw,
            phone: contact.phone,
            source: 'manual' as const,
            ingestion_method: 'csv_import',
            crm_external_id: contact.crm_external_id,
            residence_property_id: propertyIdByIndex.get(index) ?? null,
          })),
        )
        if (error) {
          if (importId) {
            await admin
              .from('crm_imports')
              .update({ status: 'failed', error_message: error.message })
              .eq('id', importId)
          }
          return NextResponse.json({ error: `Insert failed: ${error.message}` }, { status: 500 })
        }
        createdCount += phoneToInsert.length
      }

      for (const { index, contact } of phoneToUpdate) {
        const match = matchByPhone.get(contact.phone as string)!
        await admin
          .from('contacts')
          .update({
            first_name: contact.first_name,
            last_name: contact.last_name,
            full_name_raw: contact.full_name_raw,
            crm_external_id: contact.crm_external_id,
            ingestion_method: 'csv_import',
            ...(propertyIdByIndex.has(index) && {
              residence_property_id: propertyIdByIndex.get(index),
            }),
          })
          .eq('id', match.id)
        matchedCount++
      }
    }

    // No email, no phone — parser should have filtered these, but guard anyway.
    for (const _entry of orphanEntries) {
      noteSkip('missing_email_and_phone')
    }
  }

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
    skipReasons,
    phone_unparseable: phoneUnparseableCount,
    properties_touched: propertiesTouched,
    total: contacts.length + parseSkipped,
    parseErrors,
  })
}
