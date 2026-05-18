import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { detectCms, countListings, nextPageUrl, detectAll } from './detect'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) =>
  readFileSync(join(here, '__fixtures__', name), 'utf-8')

describe('detectCms', () => {
  it('flags WordPress via wp-content + generator meta', () => {
    expect(detectCms(fixture('wordpress.html'))).toBe('wordpress')
  })

  it('flags Wix via static.wixstatic.com + generator', () => {
    expect(detectCms(fixture('wix.html'))).toBe('wix')
  })

  it('flags Squarespace via static1.squarespace.com', () => {
    expect(detectCms(fixture('squarespace.html'))).toBe('squarespace')
  })

  it('flags REA portal via realestate.com.au reference', () => {
    expect(detectCms(fixture('rea-portal.html'))).toBe('rea_portal')
  })

  it('returns unknown when no markers match', () => {
    expect(detectCms(fixture('custom.html'))).toBe('unknown')
  })

  it('returns unknown for empty input', () => {
    expect(detectCms('')).toBe('unknown')
  })

  it('REA portal beats WordPress when both markers appear (order matters)', () => {
    const html = `<html><body>
      <link rel="stylesheet" href="/wp-content/themes/x.css">
      <link rel="canonical" href="https://www.realestate.com.au/agency/x">
    </body></html>`
    expect(detectCms(html)).toBe('rea_portal')
  })
})

describe('countListings', () => {
  const base = new URL('https://reidproperty.com.au')

  it('counts unique /property/* paths on the WordPress fixture', () => {
    // 3 distinct /property/ urls; one of them appears twice (with utm).
    // The external realestate.com.au listing is rejected (different host).
    expect(countListings(fixture('wordpress.html'), base)).toBe(3)
  })

  it('counts unique /listings/* paths on the Wix fixture', () => {
    expect(
      countListings(fixture('wix.html'), new URL('https://baysideboutique.com.au')),
    ).toBe(2)
  })

  it('counts unique /properties/* paths on the Squarespace fixture', () => {
    expect(
      countListings(fixture('squarespace.html'), new URL('https://mosmanliving.com.au')),
    ).toBe(3)
  })

  it('counts /for-sale/* paths on the custom fixture', () => {
    expect(
      countListings(fixture('custom.html'), new URL('https://boutiquerealty.com.au')),
    ).toBe(2)
  })

  it('ignores external-host listing links', () => {
    const html = `<a href="https://elsewhere.com/property/foo">Foo</a>`
    expect(countListings(html, base)).toBe(0)
  })

  it('dedupes by pathname (case-insensitive)', () => {
    const html = `
      <a href="/property/foo">a</a>
      <a href="/property/Foo">b</a>
      <a href="/property/foo?utm=x">c</a>`
    expect(countListings(html, base)).toBe(1)
  })

  it('returns 0 for HTML with no listing-looking anchors', () => {
    const html = `<html><body><a href="/about">About</a></body></html>`
    expect(countListings(html, base)).toBe(0)
  })
})

describe('nextPageUrl', () => {
  const base = new URL('https://boutiquerealty.com.au')

  it('finds a <link rel="next"> on the custom fixture', () => {
    const next = nextPageUrl(fixture('custom.html'), base)
    expect(next?.pathname).toBe('/for-sale/page/2/')
  })

  it('returns null when no rel=next present', () => {
    expect(nextPageUrl(fixture('wordpress.html'), base)).toBeNull()
  })

  it('handles href-then-rel attribute order', () => {
    const html = `<a href="/for-sale/p/2" rel="next">Next</a>`
    expect(nextPageUrl(html, base)?.pathname).toBe('/for-sale/p/2')
  })
})

describe('detectAll', () => {
  it('returns both cms and listings in one pass', () => {
    const out = detectAll(fixture('wordpress.html'), new URL('https://reidproperty.com.au'))
    expect(out.cms).toBe('wordpress')
    expect(out.listings).toBe(3)
  })
})
