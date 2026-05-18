import { describe, it, expect } from 'vitest'
import { suggestedHostFromEmail, suggestedUrlFromEmail } from './email-domain'

describe('suggestedHostFromEmail', () => {
  it('returns the host for an agency email', () => {
    expect(suggestedHostFromEmail('davey@reidproperty.com.au')).toBe(
      'reidproperty.com.au',
    )
  })

  it('lowercases the host', () => {
    expect(suggestedHostFromEmail('Davey@ReidProperty.com.AU')).toBe(
      'reidproperty.com.au',
    )
  })

  it('returns null for gmail', () => {
    expect(suggestedHostFromEmail('davey@gmail.com')).toBeNull()
  })

  it('returns null for outlook.com.au', () => {
    expect(suggestedHostFromEmail('davey@outlook.com.au')).toBeNull()
  })

  it('returns null for icloud', () => {
    expect(suggestedHostFromEmail('davey@icloud.com')).toBeNull()
  })

  it('returns null for missing @', () => {
    expect(suggestedHostFromEmail('davey-no-at')).toBeNull()
  })

  it('returns null for trailing @', () => {
    expect(suggestedHostFromEmail('davey@')).toBeNull()
  })

  it('returns null for null/undefined/empty', () => {
    expect(suggestedHostFromEmail(null)).toBeNull()
    expect(suggestedHostFromEmail(undefined)).toBeNull()
    expect(suggestedHostFromEmail('')).toBeNull()
  })

  it('rejects domains without a dot', () => {
    expect(suggestedHostFromEmail('davey@localhost')).toBeNull()
  })
})

describe('suggestedUrlFromEmail', () => {
  it('prepends https:// for an agency email', () => {
    expect(suggestedUrlFromEmail('davey@reidproperty.com.au')).toBe(
      'https://reidproperty.com.au',
    )
  })

  it('returns empty string for a generic provider', () => {
    expect(suggestedUrlFromEmail('davey@gmail.com')).toBe('')
  })
})
