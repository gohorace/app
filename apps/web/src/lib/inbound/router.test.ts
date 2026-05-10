import { describe, expect, it } from 'vitest'
import { extractLocalPart } from './router'

describe('extractLocalPart', () => {
  it('returns the local_part of a plain address', () => {
    expect(extractLocalPart('a7k2x9m4q1@portal.gohorace.com')).toBe('a7k2x9m4q1')
  })

  it('lowercases the local_part', () => {
    expect(extractLocalPart('A7K2X9M4Q1@portal.gohorace.com')).toBe('a7k2x9m4q1')
  })

  it('handles "Name <addr@domain>" style', () => {
    expect(extractLocalPart('Matt Powe <matt@portal.gohorace.com>')).toBe('matt')
  })

  it('returns null for null input', () => {
    expect(extractLocalPart(null)).toBeNull()
  })

  it('returns null for an address with no @', () => {
    expect(extractLocalPart('not-an-address')).toBeNull()
  })

  it('returns null for an address starting with @', () => {
    expect(extractLocalPart('@nowhere.com')).toBeNull()
  })

  it('trims whitespace', () => {
    expect(extractLocalPart('  matt@portal.gohorace.com  ')).toBe('matt')
  })
})
