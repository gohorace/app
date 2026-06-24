import { describe, it, expect } from 'vitest'
import {
  describeCandidate,
  buildReferenceContext,
  substituteSmsLink,
  assembleDrafts,
  findPersonaLeak,
  type DraftOutreachArgs,
} from './draft-outreach'
import type { ContentCandidate, MatchResult, MatchSlot } from './match-content'

const cand = (o: Partial<ContentCandidate> & { id: string; content_type: ContentCandidate['content_type'] }): ContentCandidate => ({
  property_id: null, source_url: `https://x.au/${o.id}`, suburb: 'Glebe', address: null, price_text: null,
  sold_price_text: null, bed: null, bath: null, car: null, hero_image_url: null, sold_date: null,
  listed_date: null, title: null, published_date: null, last_crawled_at: '2026-06-20T00:00:00Z', ...o,
})
const slot = (c: ContentCandidate): MatchSlot => ({ role: 'recent_sold', chosen: c, alternatives: [] })

describe('describeCandidate', () => {
  it('labels a sold result with its price', () => {
    expect(describeCandidate(cand({ id: 's', content_type: 'sold', address: '12 Smith St, Glebe', sold_price_text: '$1.2M' }))).toBe('12 Smith St, Glebe — sold $1.2M')
  })
  it('labels a report by title', () => {
    expect(describeCandidate(cand({ id: 'r', content_type: 'suburb_report', title: 'Glebe Q2 Report' }))).toBe('Glebe Q2 Report')
  })
})

describe('buildReferenceContext (internal — explicit about the signal)', () => {
  it('states the signal + lists the content + the do-not-mention reminder', () => {
    const match: MatchResult = { rule: 'viewed_sold', suburb: 'Glebe', slots: [slot(cand({ id: 's1', content_type: 'sold', address: '12 Smith St', sold_price_text: '$1.2M' }))] }
    const ctx = buildReferenceContext(match, 'Brian Lee')
    expect(ctx).toContain('Brian Lee has been looking at sold results in Glebe')
    expect(ctx).toContain('12 Smith St — sold $1.2M — https://x.au/s1')
    expect(ctx).toContain('never mention the website activity')
  })
  it('handles the no-content case', () => {
    const ctx = buildReferenceContext({ rule: 'mixed', suburb: 'Glebe', slots: [] }, 'Sam')
    expect(ctx).toContain('No fresh matching content')
  })
})

describe('findPersonaLeak (the draft must read as the agent, not a ghost-writer)', () => {
  it('catches the exact leak Andy hit', () => {
    expect(findPersonaLeak("I'm Horace, writing on behalf of your new local agent")).toBeTruthy()
  })
  it('catches Horace / on behalf of / AI framings', () => {
    expect(findPersonaLeak('Horace here')).toBe('Horace')
    expect(findPersonaLeak('on behalf of the team')).toBe('on behalf of')
    expect(findPersonaLeak("I'm an AI assistant")).toBeTruthy()
  })
  it('passes a clean first-person agent message', () => {
    expect(findPersonaLeak('Hi Sarah — thought of you. A place at 116 Hilton Terrace just sold. Max')).toBeNull()
  })
})

describe('substituteSmsLink', () => {
  it('replaces the {{link}} token', () => {
    expect(substituteSmsLink('Recent Glebe sale you might like: {{link}}', 'https://x.au/s')).toBe('Recent Glebe sale you might like: https://x.au/s')
  })
  it('appends when no token present', () => {
    expect(substituteSmsLink('Recent Glebe sale you might like', 'https://x.au/s')).toBe('Recent Glebe sale you might like https://x.au/s')
  })
  it('returns null with no url', () => {
    expect(substituteSmsLink('anything {{link}}', null)).toBeNull()
  })
})

describe('assembleDrafts', () => {
  const match: MatchResult = { rule: 'viewed_sold', suburb: 'Glebe', slots: [slot(cand({ id: 's1', content_type: 'sold' }))] }
  const args: DraftOutreachArgs = { agentName: 'Max Jones', contact: { name: 'Brian Lee', first_name: 'Brian' }, pretext: { label: 'a recent Glebe sale', source: 'recent-sold' }, match }

  it('firewall-held / no model → no lead copy, but call notes survive', () => {
    const d = assembleDrafts(null, args)
    expect(d.email).toBeNull()
    expect(d.sms).toBeNull()
    expect(d.callNotes.referenceContext).toContain('Brian Lee')
  })

  it('assembles email + sms (link substituted) + call opener', () => {
    const d = assembleDrafts({ subject: 'A recent Glebe sale', body: 'Hi Brian — thought of you.\n\nMax', sms: 'Recent Glebe sale: {{link}}', call_opener: 'Hi Brian, Max here.' }, args)
    expect(d.email?.subject).toBe('A recent Glebe sale')
    expect(d.sms).toBe('Recent Glebe sale: https://x.au/s1')
    expect(d.callNotes.spokenOpener).toBe('Hi Brian, Max here.')
  })

  it('appends the agent signature to the email body', () => {
    const d = assembleDrafts({ subject: 'S', body: 'Hi Brian.', sms: '', call_opener: 'Hi.' }, { ...args, voice: { brand_voice: null, email_signature: 'Max Jones\nDirector, Max Realty' } })
    expect(d.email?.body).toContain('Director, Max Realty')
  })
})
