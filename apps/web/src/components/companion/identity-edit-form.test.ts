import { describe, it, expect } from 'vitest'
import { splitDisplayName } from './identity-edit-form'

describe('splitDisplayName', () => {
  it('splits on the first space into first + last', () => {
    expect(splitDisplayName('Sarah Thompson')).toEqual({ first_name: 'Sarah', last_name: 'Thompson' })
  })

  it('keeps multi-word surnames in last_name', () => {
    expect(splitDisplayName('Mary Anne van der Berg')).toEqual({
      first_name: 'Mary',
      last_name: 'Anne van der Berg',
    })
  })

  it('treats a single token as first_name only', () => {
    expect(splitDisplayName('Petey')).toEqual({ first_name: 'Petey', last_name: null })
  })

  it('trims surrounding + collapsed whitespace', () => {
    expect(splitDisplayName('  Dan   ')).toEqual({ first_name: 'Dan', last_name: null })
    expect(splitDisplayName('Dan  ')).toEqual({ first_name: 'Dan', last_name: null })
  })

  it('returns nulls for an empty string', () => {
    expect(splitDisplayName('')).toEqual({ first_name: null, last_name: null })
    expect(splitDisplayName('   ')).toEqual({ first_name: null, last_name: null })
  })
})
