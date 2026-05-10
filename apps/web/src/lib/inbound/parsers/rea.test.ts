import { describe, expect, it } from 'vitest'
import type { ResendFetchedEmail } from '../types'
import { isParseError } from '../types'
import { parseREA } from './rea'

/**
 * Captured from the HOR-28 spike. Real REA enquiry submitted on a live
 * listing, all optional fields populated to validate maximum-information
 * extraction.
 */
const SPIKE_SAMPLE: ResendFetchedEmail = {
  id: 'f97559cd-a731-42ef-9106-f15acc0d88bb',
  object: 'email',
  from: 'realestate.com.au@realestate.com.au',
  to: ['rea-test-1@portal.gohorace.com'],
  cc: [],
  bcc: [],
  reply_to: ['email@andytwomey.com'],
  subject:
    'Enquiry for Property ID: 145861824, 759/61 Noosa Springs Drive, Noosa Heads Qld 4567, Listing Agent Matt Powe',
  message_id: '<010e019e11b7e15c-6aef7f04-d131-48b2-a6e6-d54fd022d737-000000@ap-southeast-1.amazonses.com>',
  created_at: '2026-05-10T11:48:46.308Z',
  headers: {},
  text: [
    '[https://assets.reastatic.net/email-templates/common/realestate-logo-bg-white.png]',
    '',
    '',
    'Hi Matt Powe,',
    '',
    '',
    'You have received a new lead from realestate.com.au for',
    '',
    '',
    'Property id: 145861824',
    '',
    'Property address: 759/61 Noosa Springs Drive, Noosa Heads Qld 4567',
    '',
    'Property URL: https://www.realestate.com.au/145861824',
    '',
    '',
    'User Details:',
    '',
    'Name: Ando T',
    '',
    'Email: email@andytwomey.com',
    '',
    'Phone: 0407581598',
    '',
    'About me: Buy but keep my current home',
    '',
    'I would like to: inspect the property, get information about Rates & Fees, be',
    'contacted about similar properties and get an indication of price.',
    '',
    'Comments: Hey Matt, can we take a look at this property sometime? Might be',
    'easier to have a call when you have a moment. Cheers.',
    '',
    'You can only use the personal information contained in this email enquiry for',
    'the purposes of contacting the person about their enquiry. You must comply with',
    'the Privacy Act 1988 (Cth).',
  ].join('\n'),
  html: null,
}

describe('parseREA — full enquiry (HOR-28 spike capture)', () => {
  const result = parseREA(SPIKE_SAMPLE)

  it('does not return an error for a well-formed REA email', () => {
    expect(isParseError(result)).toBe(false)
  })

  it('extracts the listing agent from the greeting', () => {
    if (isParseError(result)) throw new Error('unexpected parse error')
    expect(result.listing_agent_name).toBe('Matt Powe')
  })

  it('extracts listing identifiers', () => {
    if (isParseError(result)) throw new Error('unexpected parse error')
    expect(result.listing_external_id).toBe('145861824')
    expect(result.listing_address).toBe('759/61 Noosa Springs Drive, Noosa Heads Qld 4567')
    expect(result.listing_url).toBe('https://www.realestate.com.au/145861824')
  })

  it('extracts enquirer name and phone from the body', () => {
    if (isParseError(result)) throw new Error('unexpected parse error')
    expect(result.enquirer_name).toBe('Ando T')
    expect(result.enquirer_phone).toBe('0407581598')
  })

  it('prefers reply_to header for enquirer email over body parsing', () => {
    if (isParseError(result)) throw new Error('unexpected parse error')
    expect(result.enquirer_email).toBe('email@andytwomey.com')
  })

  it('extracts the buyer intent', () => {
    if (isParseError(result)) throw new Error('unexpected parse error')
    expect(result.intent).toBe('Buy but keep my current home')
  })

  it('splits "I would like to:" into a string array, joining wrapped lines', () => {
    if (isParseError(result)) throw new Error('unexpected parse error')
    expect(result.requested_actions).toEqual([
      'inspect the property',
      'get information about Rates & Fees',
      'be contacted about similar properties and get an indication of price.',
    ])
  })

  it('extracts multi-line Comments stopping at the legal disclaimer', () => {
    if (isParseError(result)) throw new Error('unexpected parse error')
    expect(result.message).toContain('Hey Matt, can we take a look at this property sometime?')
    expect(result.message).toContain('Cheers.')
    expect(result.message).not.toContain('Privacy Act 1988')
  })
})

describe('parseREA — fallback behaviours', () => {
  it('returns no_text_body when text is missing', () => {
    const r = parseREA({ ...SPIKE_SAMPLE, text: null })
    expect(isParseError(r)).toBe(true)
    if (!isParseError(r)) return
    expect(r.error).toBe('no_text_body')
  })

  it('falls back to body Email: line when reply_to is empty', () => {
    const r = parseREA({ ...SPIKE_SAMPLE, reply_to: [] })
    if (isParseError(r)) throw new Error('unexpected parse error')
    expect(r.enquirer_email).toBe('email@andytwomey.com')
  })

  it('returns null fields rather than failing when optional lines are absent', () => {
    // Mirrors REA's real format: blank lines between every Key: value block.
    const minimalText = [
      'Hi Sarah Khan,',
      '',
      'Property id: 99999999',
      '',
      'Property address: 1 Example St, Sydney NSW 2000',
      '',
      'Property URL: https://www.realestate.com.au/99999999',
      '',
      'User Details:',
      '',
      'Name: Test User',
      '',
      'Email: test@example.com',
    ].join('\n')

    const r = parseREA({ ...SPIKE_SAMPLE, text: minimalText, reply_to: ['test@example.com'] })
    if (isParseError(r)) throw new Error('unexpected parse error')
    expect(r.listing_agent_name).toBe('Sarah Khan')
    expect(r.listing_external_id).toBe('99999999')
    expect(r.enquirer_name).toBe('Test User')
    expect(r.enquirer_email).toBe('test@example.com')
    expect(r.enquirer_phone).toBeNull()
    expect(r.intent).toBeNull()
    expect(r.message).toBeNull()
    expect(r.requested_actions).toEqual([])
  })
})
