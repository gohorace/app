/**
 * Shared types for inbound email capture (HOR-63).
 *
 * The webhook handler receives a small metadata payload from Resend
 * (`email.received` event), then fetches the full email body via
 * Resend's Received Emails API. Parsers operate on the fetched
 * payload and return a structured ParsedEnquiry or a ParseError.
 */

/** Subset of fields we use from Resend's GET /emails/receiving/{id} response. */
export type ResendFetchedEmail = {
  id: string
  object?: string
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  reply_to?: string[] | null
  subject: string
  text: string | null
  html: string | null
  /** Resend returns headers as an object keyed by lowercase header name. */
  headers: Record<string, unknown>
  message_id?: string
  created_at: string
  raw?: { download_url: string; expires_at: string } | null
  attachments?: Array<{
    filename?: string
    content_type?: string
    content_disposition?: string
    content_id?: string
  }>
}

/** Structured enquiry extracted from a portal email. */
export type ParsedEnquiry = {
  // Listing
  listing_external_id: string | null
  listing_address: string | null
  listing_url: string | null
  /** Name addressed in greeting, e.g. "Hi Matt Powe," → "Matt Powe". */
  listing_agent_name: string | null

  // Enquirer
  enquirer_name: string | null
  enquirer_email: string | null
  enquirer_phone: string | null

  // Free-text
  message: string | null
  intent: string | null
  requested_actions: string[]
}

export type ParseError = {
  error:
    | 'no_text_body'
    | 'unrecognised_format'
    | 'missing_required_field'
  detail?: string
}

export type ParseResult = ParsedEnquiry | ParseError

export function isParseError(r: ParseResult): r is ParseError {
  return 'error' in r
}
