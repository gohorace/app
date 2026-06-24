import { describe, it, expect } from 'vitest'
import { parseRobots } from './robots'

describe('parseRobots', () => {
  it('allows everything when robots is empty', () => {
    const r = parseRobots('')
    expect(r.allowed('/anything')).toBe(true)
    expect(r.sitemaps).toEqual([])
  })

  it('collects Sitemap directives', () => {
    const r = parseRobots(
      'Sitemap: https://x.au/sitemap.xml\nSitemap: https://x.au/wp-sitemap.xml\nUser-agent: *\nDisallow:',
    )
    expect(r.sitemaps).toEqual(['https://x.au/sitemap.xml', 'https://x.au/wp-sitemap.xml'])
  })

  it('honours a Disallow under the * group', () => {
    const r = parseRobots('User-agent: *\nDisallow: /private')
    expect(r.allowed('/private/x')).toBe(false)
    expect(r.allowed('/public')).toBe(true)
  })

  it('Allow overrides a less specific Disallow (longest match wins)', () => {
    const r = parseRobots('User-agent: *\nDisallow: /listings\nAllow: /listings/public')
    expect(r.allowed('/listings/secret')).toBe(false)
    expect(r.allowed('/listings/public/1')).toBe(true)
  })

  it('prefers a HoraceBot-specific group over *', () => {
    const r = parseRobots(
      'User-agent: *\nDisallow: /\nUser-agent: HoraceBot\nDisallow:',
    )
    expect(r.allowed('/listings/1')).toBe(true)
  })

  it('parses crawl-delay into ms', () => {
    const r = parseRobots('User-agent: *\nCrawl-delay: 2')
    expect(r.crawlDelayMs).toBe(2000)
  })

  it('ignores comments', () => {
    const r = parseRobots('# a comment\nUser-agent: *\nDisallow: /x # trailing')
    expect(r.allowed('/x/1')).toBe(false)
  })
})
