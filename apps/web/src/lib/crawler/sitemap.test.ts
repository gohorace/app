import { describe, it, expect } from 'vitest'
import { parseSitemapXml } from './sitemap'

describe('parseSitemapXml', () => {
  it('extracts page <loc> from a urlset', () => {
    const xml = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://x.au/listings/1</loc></url>
        <url><loc>https://x.au/sold/2</loc></url>
      </urlset>`
    const { sitemaps, pages } = parseSitemapXml(xml)
    expect(sitemaps).toEqual([])
    expect(pages).toEqual(['https://x.au/listings/1', 'https://x.au/sold/2'])
  })

  it('extracts child sitemaps from a sitemapindex', () => {
    const xml = `<?xml version="1.0"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://x.au/wp-sitemap-posts-listing-1.xml</loc></sitemap>
        <sitemap><loc>https://x.au/wp-sitemap-posts-page-1.xml</loc></sitemap>
      </sitemapindex>`
    const { sitemaps, pages } = parseSitemapXml(xml)
    expect(sitemaps).toEqual([
      'https://x.au/wp-sitemap-posts-listing-1.xml',
      'https://x.au/wp-sitemap-posts-page-1.xml',
    ])
    expect(pages).toEqual([])
  })

  it('falls back to bare <loc> when wrappers are missing', () => {
    const { pages } = parseSitemapXml('<loc>https://x.au/property/1</loc>')
    expect(pages).toEqual(['https://x.au/property/1'])
  })
})
