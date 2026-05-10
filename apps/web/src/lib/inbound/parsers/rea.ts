import type { ParsedEnquiry, ParseResult, ResendFetchedEmail } from '../types'

/**
 * Parse a realestate.com.au enquiry email.
 *
 * REA's body is a templated `Key: value\n` format with each key/value
 * pair separated by blank lines. Multi-line values (like a long
 * `Comments:` or a wrapped `I would like to:`) sit within a single
 * paragraph; the next paragraph is the next field.
 *
 * Sample (paraphrased from HOR-28 spike capture):
 *
 *   Hi Matt Powe,
 *
 *   You have received a new lead from realestate.com.au for
 *
 *   Property id: 145861824
 *
 *   Property address: 759/61 Noosa Springs Drive, Noosa Heads Qld 4567
 *
 *   Property URL: https://www.realestate.com.au/145861824
 *
 *   User Details:
 *
 *   Name: Ando T
 *
 *   Email: email@andytwomey.com
 *
 *   Phone: 0407581598
 *
 *   About me: Buy but keep my current home
 *
 *   I would like to: inspect the property, get information about Rates & Fees, be
 *   contacted about similar properties and get an indication of price.
 *
 *   Comments: Hey Matt, can we take a look at this property sometime? Might be
 *   easier to have a call when you have a moment. Cheers.
 *
 *   You can only use the personal information contained in this email enquiry...
 *
 * The enquirer's email is also in the `reply_to` header — preferred over
 * body parsing because it's set by REA's mail system, not user input.
 *
 * Optional fields (Phone, Comments, About me, I would like to) are
 * omitted from the body when the enquirer leaves them blank — handled
 * by returning null rather than failing.
 */
export function parseREA(fetched: ResendFetchedEmail): ParseResult {
  const text = fetched.text
  if (!text) {
    return { error: 'no_text_body', detail: 'REA email had no plaintext body' }
  }

  const fields = parseSections(text)

  // Listing agent — body opens with "Hi <Name>,"
  const greetingMatch = text.match(/^Hi\s+(.+?),\s*$/m)
  const listing_agent_name = greetingMatch?.[1]?.trim() ?? null

  // Enquirer email: prefer reply_to header (REA-set, not user-entered)
  const enquirer_email = pickFirstNonEmpty(fetched.reply_to) ?? fields['Email'] ?? null

  // "I would like to:" — comma-separated list of intents.
  const requestedRaw = fields['I would like to']
  const requested_actions = requestedRaw
    ? requestedRaw
        .split(/,\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
    : []

  // Drop the trailing legal disclaimer if it accidentally got pulled in.
  // REA's disclaimer always opens with "You can only use the personal
  // information contained in this email enquiry..."
  const message = stripDisclaimer(fields['Comments']) ?? null

  const parsed: ParsedEnquiry = {
    listing_external_id: fields['Property id'] ?? null,
    listing_address: fields['Property address'] ?? null,
    listing_url: fields['Property URL'] ?? null,
    listing_agent_name,
    enquirer_name: fields['Name'] ?? null,
    enquirer_email,
    enquirer_phone: fields['Phone'] ?? null,
    message,
    intent: fields['About me'] ?? null,
    requested_actions,
  }
  return parsed
}

/**
 * Split REA's body into Key: value blocks delimited by blank lines.
 * Returns a flat record keyed by the label (without the colon).
 *
 * Wrapped values (newlines mid-paragraph) are joined with single spaces.
 */
function parseSections(text: string): Record<string, string> {
  const blocks = text.split(/\n\s*\n/)
  const result: Record<string, string> = {}
  for (const block of blocks) {
    const m = block.match(/^([A-Za-z][A-Za-z0-9 ]*?):\s*([\s\S]+)$/)
    if (!m) continue
    const key = m[1].trim()
    const value = m[2].replace(/\s+/g, ' ').trim()
    if (value.length > 0) result[key] = value
  }
  return result
}

function stripDisclaimer(value: string | undefined): string | null {
  if (!value) return null
  const idx = value.indexOf('You can only use the personal information')
  const trimmed = idx > 0 ? value.slice(0, idx).trim() : value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function pickFirstNonEmpty(arr: string[] | null | undefined): string | null {
  if (!arr) return null
  for (const v of arr) {
    if (typeof v === 'string' && v.trim().length > 0) return v.trim()
  }
  return null
}
