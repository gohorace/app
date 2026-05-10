import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database.types'
import { parseEmail } from './parsers'
import { isParseError, type ParsedEnquiry, type ResendFetchedEmail } from './types'

type Admin = SupabaseClient<Database>

export type RouterInput = {
  /** Raw Resend webhook payload (`type: 'email.received'`). */
  webhookPayload: unknown
  /** Resolved fetched email body (from GET /emails/receiving/{id}). May be null on fetch failure. */
  fetchedEmail: ResendFetchedEmail | null
  /** Extracted from webhook payload by the route handler. */
  meta: {
    fromAddress: string | null
    toAddress: string | null
    subject: string | null
    messageId: string | null
    sourcePortal: string | null
  }
}

export type RouterOutcome =
  | { kind: 'parsed'; inboundEmailId: string; enquiryId: string; contactId: string | null }
  | { kind: 'no_match'; inboundEmailId: string }
  | { kind: 'parse_failed'; inboundEmailId: string; error: string; detail?: string }
  | { kind: 'pending_body'; inboundEmailId: string }
  | { kind: 'error'; error: string }

/**
 * Orchestrates the inbound capture pipeline: address lookup → row insert
 * → parser dispatch → contact + enquiry write. Idempotent on Message-ID;
 * replays update the existing inbound_emails row and re-write the
 * matching enquiry.
 */
export async function processInboundEmail(
  admin: Admin,
  input: RouterInput,
): Promise<RouterOutcome> {
  const { webhookPayload, fetchedEmail, meta } = input

  // Resolve agent_id from the recipient's local_part.
  const localPart = extractLocalPart(meta.toAddress)
  const agentId = await resolveAgentId(admin, localPart)

  const initialStatus: Database['public']['Tables']['inbound_emails']['Insert']['parse_status'] =
    fetchedEmail
      ? agentId
        ? 'pending_body' // we'll flip below based on parse outcome
        : 'no_match'
      : 'pending_body'

  // Upsert inbound_emails row. Replays update on message_id.
  const { data: inserted, error: insertErr } = await admin
    .from('inbound_emails')
    .upsert(
      {
        agent_id: agentId,
        source_portal: meta.sourcePortal,
        message_id: meta.messageId,
        webhook_payload: webhookPayload as Json,
        fetched_payload: (fetchedEmail as unknown as Json) ?? null,
        parse_status: initialStatus,
      },
      { onConflict: 'message_id' },
    )
    .select('id')
    .single()

  if (insertErr || !inserted) {
    console.error('inbound-router: insert failed', insertErr)
    return { kind: 'error', error: insertErr?.message ?? 'insert_failed' }
  }

  const inboundEmailId = inserted.id

  // No agent matched the local_part — capture and stop.
  if (!agentId) {
    console.warn('inbound-router: no agent for local_part', { localPart, toAddress: meta.toAddress })
    return { kind: 'no_match', inboundEmailId }
  }

  // No body fetched (yet) — capture row, exit. Replay or follow-up can re-run.
  if (!fetchedEmail) {
    return { kind: 'pending_body', inboundEmailId }
  }

  // Parse.
  const parseResult = parseEmail(meta.sourcePortal, fetchedEmail)

  if (isParseError(parseResult)) {
    await admin
      .from('inbound_emails')
      .update({ parse_status: 'parse_failed', parse_error: parseResult.detail ?? parseResult.error })
      .eq('id', inboundEmailId)
    return {
      kind: 'parse_failed',
      inboundEmailId,
      error: parseResult.error,
      detail: parseResult.detail,
    }
  }

  // Find or create contact by (agent_id, lowercased email).
  const contactId = await findOrCreateContact(admin, agentId, parseResult)

  // Upsert enquiry. UNIQUE on inbound_email_id makes replay idempotent.
  const { data: enquiry, error: enqErr } = await admin
    .from('enquiries')
    .upsert(
      {
        inbound_email_id: inboundEmailId,
        agent_id: agentId,
        contact_id: contactId,
        listing_external_id: parseResult.listing_external_id,
        listing_address: parseResult.listing_address,
        listing_url: parseResult.listing_url,
        listing_agent_name: parseResult.listing_agent_name,
        enquirer_name: parseResult.enquirer_name,
        enquirer_email: parseResult.enquirer_email,
        enquirer_phone: parseResult.enquirer_phone,
        message: parseResult.message,
        intent: parseResult.intent,
        requested_actions: parseResult.requested_actions,
      },
      { onConflict: 'inbound_email_id' },
    )
    .select('id')
    .single()

  if (enqErr || !enquiry) {
    console.error('inbound-router: enquiry upsert failed', enqErr)
    await admin
      .from('inbound_emails')
      .update({ parse_status: 'parse_failed', parse_error: `enquiry_upsert: ${enqErr?.message}` })
      .eq('id', inboundEmailId)
    return { kind: 'error', error: enqErr?.message ?? 'enquiry_upsert_failed' }
  }

  await admin
    .from('inbound_emails')
    .update({ parse_status: 'parsed', parse_error: null })
    .eq('id', inboundEmailId)

  return {
    kind: 'parsed',
    inboundEmailId,
    enquiryId: enquiry.id,
    contactId,
  }
}

/** Pull the local part out of an `<addr>@<domain>` string. */
export function extractLocalPart(toAddress: string | null): string | null {
  if (!toAddress) return null
  // Handle "Name <addr@domain>" style if it ever leaks through.
  const angle = toAddress.match(/<([^>]+)>/)
  const addr = angle?.[1] ?? toAddress
  const at = addr.indexOf('@')
  if (at <= 0) return null
  return addr.slice(0, at).trim().toLowerCase() || null
}

async function resolveAgentId(admin: Admin, localPart: string | null): Promise<string | null> {
  if (!localPart) return null
  const { data } = await admin
    .from('agent_inbound_addresses')
    .select('agent_id')
    .eq('local_part', localPart)
    .eq('is_active', true)
    .maybeSingle()
  return data?.agent_id ?? null
}

/**
 * Find an existing contact for this agent by lowercased email; create if
 * none exists. Race-condition risk if two enquiries arrive simultaneously
 * with the same email; HOR-63 notes this and tolerates it for v1.
 */
async function findOrCreateContact(
  admin: Admin,
  agentId: string,
  parsed: ParsedEnquiry,
): Promise<string | null> {
  const email = parsed.enquirer_email?.toLowerCase().trim() || null

  if (email) {
    const { data: existing } = await admin
      .from('contacts')
      .select('id')
      .eq('agent_id', agentId)
      .ilike('email', email)
      .maybeSingle()
    if (existing) return existing.id
  }

  // Split "Ando T" into first/last where possible. Conservative — if just
  // one word, treat as first_name.
  const { firstName, lastName } = splitName(parsed.enquirer_name)

  const { data: created, error } = await admin
    .from('contacts')
    .insert({
      agent_id: agentId,
      email,
      phone: parsed.enquirer_phone,
      first_name: firstName,
      last_name: lastName,
      // Stop-gap until Phase 1c rename. Closest existing value to "portal-sourced".
      crm_source: 'website',
      identified_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error || !created) {
    console.error('inbound-router: contact insert failed', error)
    return null
  }
  return created.id
}

function splitName(name: string | null): { firstName: string | null; lastName: string | null } {
  if (!name) return { firstName: null, lastName: null }
  const trimmed = name.trim()
  if (!trimmed) return { firstName: null, lastName: null }
  const space = trimmed.indexOf(' ')
  if (space < 0) return { firstName: trimmed, lastName: null }
  return {
    firstName: trimmed.slice(0, space).trim(),
    lastName: trimmed.slice(space + 1).trim() || null,
  }
}
