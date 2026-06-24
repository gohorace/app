import { describe, it, expect } from 'vitest'
import { isFreshCandidate, type FreshnessRow } from './freshness'

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

function row(overrides: Partial<FreshnessRow>): FreshnessRow {
  return {
    id: 'x',
    content_type: 'listing',
    source_url: 'https://x.au/listing/1',
    last_http_status: 200,
    last_crawled_at: daysAgo(1),
    last_verified_at: null,
    sold_date: null,
    still_active: true,
    ...overrides,
  }
}

describe('isFreshCandidate', () => {
  it('passes a fresh, active, 200 listing', () => {
    expect(isFreshCandidate(row({}))).toBe(true)
  })

  it('rejects a non-200 last check', () => {
    expect(isFreshCandidate(row({ last_http_status: 404 }))).toBe(false)
    expect(isFreshCandidate(row({ last_http_status: null }))).toBe(false)
  })

  it('rejects a listing no longer active', () => {
    expect(isFreshCandidate(row({ still_active: false }))).toBe(false)
    expect(isFreshCandidate(row({ still_active: null }))).toBe(false)
  })

  it('rejects content older than the window', () => {
    expect(isFreshCandidate(row({ last_crawled_at: daysAgo(20) }))).toBe(false)
  })

  it('keeps an item kept fresh by a recent verify even if crawled long ago', () => {
    expect(isFreshCandidate(row({ last_crawled_at: daysAgo(20), last_verified_at: daysAgo(1) }))).toBe(true)
  })

  it('requires a sold_date for sold results', () => {
    expect(isFreshCandidate(row({ content_type: 'sold', still_active: null, sold_date: daysAgo(5) }))).toBe(true)
    expect(isFreshCandidate(row({ content_type: 'sold', still_active: null, sold_date: null }))).toBe(false)
  })

  it('passes a fresh suburb report (no still_active/sold_date needed)', () => {
    expect(isFreshCandidate(row({ content_type: 'suburb_report', still_active: null }))).toBe(true)
  })

  it('honours a custom max-age', () => {
    expect(isFreshCandidate(row({ last_crawled_at: daysAgo(10) }), 7)).toBe(false)
  })
})
