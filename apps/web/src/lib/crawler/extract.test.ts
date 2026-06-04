import { describe, it, expect } from 'vitest'
import { extractContent } from './extract'

describe('extractContent — schema.org JSON-LD', () => {
  const html = `<html><head>
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'RealEstateListing',
      name: '12 Smith Street, Glebe',
      image: ['https://x.au/img/hero.jpg'],
      datePosted: '2026-05-20',
      numberOfBedrooms: 3,
      numberOfBathroomsTotal: 2,
      offers: { '@type': 'Offer', price: '$1,450,000' },
      address: {
        '@type': 'PostalAddress',
        streetAddress: '12 Smith Street',
        addressLocality: 'Glebe',
        addressRegion: 'NSW',
        postalCode: '2037',
      },
    })}</script></head><body><h1>12 Smith Street, Glebe</h1></body></html>`

  it('pulls a structured address (so it can match a property by hash)', () => {
    const out = extractContent(html, 'https://x.au/listings/12-smith-st', 'listing')
    expect(out.street_number).toBe('12')
    expect(out.street_name).toBe('Smith Street')
    expect(out.suburb).toBe('Glebe')
    expect(out.state).toBe('NSW')
    expect(out.postcode).toBe('2037')
  })

  it('pulls price, image, beds/baths, listed date', () => {
    const out = extractContent(html, 'https://x.au/listings/12-smith-st', 'listing')
    expect(out.price_text).toBe('$1,450,000')
    expect(out.hero_image_url).toBe('https://x.au/img/hero.jpg')
    expect(out.bed).toBe(3)
    expect(out.bath).toBe(2)
    expect(out.listed_date).toBe('2026-05-20')
    expect(out.still_active).toBe(true)
  })

  it('routes price to sold_price_text for sold pages', () => {
    const out = extractContent(html, 'https://x.au/sold/12-smith-st', 'sold')
    expect(out.sold_price_text).toBe('$1,450,000')
    expect(out.price_text).toBeUndefined()
  })
})

describe('extractContent — fallbacks', () => {
  it('uses Open Graph tags when no JSON-LD', () => {
    const html = `<html><head>
      <meta property="og:title" content="45 Jones Avenue, Newtown" />
      <meta property="og:image" content="https://x.au/og.jpg" />
      </head><body>3 bed 1 bath 2 car</body></html>`
    const out = extractContent(html, 'https://x.au/property/45-jones', 'listing')
    expect(out.title).toBe('45 Jones Avenue, Newtown')
    expect(out.hero_image_url).toBe('https://x.au/og.jpg')
    expect(out.bed).toBe(3)
    expect(out.bath).toBe(1)
    expect(out.car).toBe(2)
  })

  it('flags a listing with a Sold banner as no longer active', () => {
    const html = `<html><body><h1>12 Smith Street — SOLD</h1></body></html>`
    const out = extractContent(html, 'https://x.au/listings/12-smith', 'listing')
    expect(out.still_active).toBe(false)
  })

  it('recovers a truncated street from the URL slug (anchored on the known suburb)', () => {
    // Real maxproperty.au case: schema.org streetAddress is just "61".
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'House',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '61',
          addressLocality: 'Noosa Heads',
          addressRegion: 'Qld',
          postalCode: '4567',
        },
      })}</script></head><body></body></html>`
    const out = extractContent(
      html,
      'https://maxproperty.au/listing/759-61-noosa-springs-drive-noosa-heads-qld-4567/',
      'listing',
    )
    expect(out.street_number).toBe('61')
    expect(out.street_name).toBe('Noosa Springs Drive')
    expect(out.suburb).toBe('Noosa Heads')
  })

  it('handles the /properties/<address>/<rex-ID> convention: address from the prior segment + captures the ID', () => {
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'House',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '61',
          addressLocality: 'Noosa Heads',
          addressRegion: 'Qld',
          postalCode: '4567',
        },
      })}</script></head><body></body></html>`
    const out = extractContent(
      html,
      'https://maxproperty.au/properties/61-noosa-springs-drive-noosa-heads-qld-4567/rex-12345',
      'listing',
    )
    expect(out.street_number).toBe('61')
    expect(out.street_name).toBe('Noosa Springs Drive')
    expect(out.suburb).toBe('Noosa Heads')
    expect(out.external_id).toBe('rex-12345')
  })

  const glebeLd = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'House',
    address: { '@type': 'PostalAddress', streetAddress: '12', addressLocality: 'Glebe', addressRegion: 'NSW', postalCode: '2037' },
  })}</script>`

  it('treats a bare numeric tail as the ID too (/properties/<address>/12345)', () => {
    const out = extractContent(`<html><head>${glebeLd}</head></html>`, 'https://x.au/properties/12-smith-street-glebe-nsw-2037/12345', 'listing')
    expect(out.street_number).toBe('12')
    expect(out.street_name).toBe('Smith Street')
    expect(out.external_id).toBe('12345')
  })

  it('does not treat a /listing/<slug ending in postcode> as an ID tail', () => {
    const noosaLd = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'House',
      address: { '@type': 'PostalAddress', streetAddress: '61', addressLocality: 'Noosa Heads', addressRegion: 'Qld', postalCode: '4567' },
    })}</script>`
    const out = extractContent(
      `<html><head>${noosaLd}</head></html>`,
      'https://maxproperty.au/listing/759-61-noosa-springs-drive-noosa-heads-qld-4567/',
      'listing',
    )
    // Last segment is the address slug (ends in postcode but is multi-word), not an ID.
    expect(out.external_id).toBeUndefined()
    expect(out.street_name).toBe('Noosa Springs Drive')
  })

  it('drops a bare-number street when the slug yields nothing usable (no junk property)', () => {
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'House',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '61',
          addressLocality: 'Noosa Heads',
          addressRegion: 'Qld',
          postalCode: '4567',
        },
      })}</script></head><body></body></html>`
    const out = extractContent(html, 'https://x.au/listing/12345/', 'listing')
    expect(out.street_name).toBeUndefined()
    expect(out.street_number).toBeUndefined()
    expect(out.suburb).toBe('Noosa Heads') // content row still captured + suburb-matchable
  })

  it('extracts suburb-report title + published date + suburb from URL', () => {
    const html = `<html><head>
      <meta property="og:title" content="Glebe Market Report — Q2 2026" />
      <meta property="article:published_time" content="2026-04-01T09:00:00+10:00" />
      </head><body></body></html>`
    const out = extractContent(html, 'https://x.au/suburb-report/glebe', 'suburb_report')
    expect(out.title).toBe('Glebe Market Report — Q2 2026')
    expect(out.published_date).toBe('2026-04-01')
    expect(out.suburb).toBe('Glebe')
  })
})
