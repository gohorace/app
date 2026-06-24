import { describe, it, expect } from 'vitest'
import {
  summarizeActivity,
  chooseRule,
  anchorSuburb,
  sortByRecency,
  buildSlots,
  type SignalEvent,
  type ContentCandidate,
  type MatchContentType,
} from './match-content'

const ev = (o: Partial<SignalEvent>): SignalEvent => ({
  event_type: 'page_view',
  page_type: null,
  suburb: null,
  property_id: null,
  session_id: null,
  occurred_at: '2026-06-01T00:00:00Z',
  ...o,
})

const cand = (o: Partial<ContentCandidate> & { id: string; content_type: MatchContentType }): ContentCandidate => ({
  property_id: null,
  source_url: `https://x.au/${o.id}`,
  suburb: 'Glebe',
  address: null,
  price_text: null,
  sold_price_text: null,
  bed: null,
  bath: null,
  car: null,
  hero_image_url: null,
  sold_date: null,
  listed_date: null,
  title: null,
  published_date: null,
  last_crawled_at: '2026-06-01T00:00:00Z',
  ...o,
})

describe('summarizeActivity', () => {
  it('detects a repeat single-listing view', () => {
    const s = summarizeActivity([
      ev({ page_type: 'listing', property_id: 'p1', suburb: 'Glebe', session_id: 's1' }),
      ev({ page_type: 'listing', property_id: 'p1', suburb: 'Glebe', session_id: 's2' }),
    ])
    expect(s.repeatListing).toEqual({ propertyId: 'p1', suburb: 'Glebe', count: 2 })
    expect(s.sessionCount).toBe(2)
    expect(s.primarySuburb).toBe('Glebe')
  })

  it('tracks sold / report / appraisal signals by suburb', () => {
    const s = summarizeActivity([
      ev({ page_type: 'sold', suburb: 'Newtown' }),
      ev({ page_type: 'suburb_report', suburb: 'Erskineville' }),
      ev({ page_type: 'appraisal' }),
    ])
    expect(s.soldSuburb).toBe('Newtown')
    expect(s.reportSuburb).toBe('Erskineville')
    expect(s.appraisalVisits).toBe(1)
  })
})

describe('chooseRule priority', () => {
  const base = { sessionCount: 1, primarySuburb: 'Glebe', soldSuburb: 'Glebe', reportSuburb: 'Glebe', appraisalVisits: 1, repeatListing: { propertyId: 'p1', suburb: 'Glebe', count: 3 } }
  it('repeat listing wins over everything', () => {
    expect(chooseRule({ ...base })).toBe('repeat_listing')
  })
  it('appraisal next', () => {
    expect(chooseRule({ ...base, repeatListing: null })).toBe('appraisal')
  })
  it('then viewed sold', () => {
    expect(chooseRule({ ...base, repeatListing: null, appraisalVisits: 0 })).toBe('viewed_sold')
  })
  it('then report download', () => {
    expect(chooseRule({ ...base, repeatListing: null, appraisalVisits: 0, soldSuburb: null })).toBe('report_download')
  })
  it('then mixed', () => {
    expect(chooseRule({ ...base, repeatListing: null, appraisalVisits: 0, soldSuburb: null, reportSuburb: null })).toBe('mixed')
  })
  it('none when no suburb at all', () => {
    expect(chooseRule({ sessionCount: 0, primarySuburb: null, soldSuburb: null, reportSuburb: null, appraisalVisits: 0, repeatListing: null })).toBe('none')
  })
})

describe('anchorSuburb', () => {
  it('uses the repeat listing suburb, else the relevant signal suburb', () => {
    expect(anchorSuburb('repeat_listing', { repeatListing: { propertyId: 'p', suburb: 'Glebe', count: 2 } } as never)).toBe('Glebe')
    expect(anchorSuburb('viewed_sold', { soldSuburb: 'Newtown' } as never)).toBe('Newtown')
    expect(anchorSuburb('none', {} as never)).toBeNull()
  })
})

describe('sortByRecency', () => {
  it('sorts sold by sold_date desc', () => {
    const out = sortByRecency('sold', [
      cand({ id: 'a', content_type: 'sold', sold_date: '2026-01-01' }),
      cand({ id: 'b', content_type: 'sold', sold_date: '2026-05-01' }),
    ])
    expect(out.map((c) => c.id)).toEqual(['b', 'a'])
  })
})

describe('buildSlots', () => {
  const summary = { sessionCount: 1, primarySuburb: 'Glebe', soldSuburb: 'Glebe', reportSuburb: 'Glebe', appraisalVisits: 0, repeatListing: { propertyId: 'p1', suburb: 'Glebe', count: 2 } }

  it('repeat_listing → the viewed listing + a comparable sold, with capped alternatives', () => {
    const listings = [
      cand({ id: 'L1', content_type: 'listing', property_id: 'p1' }),
      cand({ id: 'L2', content_type: 'listing', property_id: 'p2' }),
      cand({ id: 'L3', content_type: 'listing', property_id: 'p3' }),
    ]
    const solds = Array.from({ length: 6 }, (_, i) => cand({ id: `S${i}`, content_type: 'sold', sold_date: `2026-0${(i % 9) + 1}-01` }))
    const slots = buildSlots('repeat_listing', summary, { listing: listings, sold: solds })
    expect(slots.map((s) => s.role)).toEqual(['listing', 'comparable_sold'])
    expect(slots[0].chosen.id).toBe('L1') // the viewed property
    expect(slots[0].alternatives.length).toBe(2)
    expect(slots[1].alternatives.length).toBe(4) // top-5 total, capped
  })

  it('repeat_listing → omits the listing slot when the viewed listing is no longer fresh', () => {
    const slots = buildSlots('repeat_listing', summary, {
      listing: [cand({ id: 'L2', content_type: 'listing', property_id: 'p2' })], // p1 not present
      sold: [cand({ id: 'S1', content_type: 'sold', sold_date: '2026-05-01' })],
    })
    expect(slots.map((s) => s.role)).toEqual(['comparable_sold'])
  })

  it('viewed_sold → up to 2 recent sold slots', () => {
    const solds = [cand({ id: 'S1', content_type: 'sold', sold_date: '2026-05-01' }), cand({ id: 'S2', content_type: 'sold', sold_date: '2026-04-01' })]
    const slots = buildSlots('viewed_sold', summary, { sold: solds })
    expect(slots.map((s) => s.chosen.id)).toEqual(['S1', 'S2'])
  })

  it('mixed → one suburb report', () => {
    const slots = buildSlots('mixed', summary, { suburb_report: [cand({ id: 'R1', content_type: 'suburb_report' })] })
    expect(slots).toHaveLength(1)
    expect(slots[0].role).toBe('suburb_report')
  })

  it('empty pool → no slot (bias to omission, never stretched)', () => {
    expect(buildSlots('viewed_sold', summary, { sold: [] })).toEqual([])
    expect(buildSlots('mixed', summary, {})).toEqual([])
  })
})
