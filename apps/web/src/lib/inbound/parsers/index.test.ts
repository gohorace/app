import { describe, expect, it } from 'vitest'
import { parseEmail } from './index'
import { isParseError } from '../types'

const FAKE_FETCHED = {
  id: 'x',
  from: 'realestate.com.au@realestate.com.au',
  to: ['x@portal.gohorace.com'],
  subject: 'test',
  text: 'Hi Foo,\n\nProperty id: 1\n\nName: Bar\n\nEmail: bar@example.com\n',
  html: null,
  headers: {},
  reply_to: ['bar@example.com'],
  created_at: '2026-05-10T00:00:00Z',
}

describe('parseEmail dispatcher', () => {
  it('routes "rea" to the REA parser', () => {
    const r = parseEmail('rea', FAKE_FETCHED)
    expect(isParseError(r)).toBe(false)
  })

  it('returns unrecognised_format for "domain" (parser not yet implemented)', () => {
    const r = parseEmail('domain', FAKE_FETCHED)
    expect(isParseError(r)).toBe(true)
    if (!isParseError(r)) return
    expect(r.error).toBe('unrecognised_format')
  })

  it('returns unrecognised_format for unknown source_portal', () => {
    const r = parseEmail('other', FAKE_FETCHED)
    expect(isParseError(r)).toBe(true)
    if (!isParseError(r)) return
    expect(r.error).toBe('unrecognised_format')
  })

  it('returns unrecognised_format for null source_portal', () => {
    const r = parseEmail(null, FAKE_FETCHED)
    expect(isParseError(r)).toBe(true)
  })
})
