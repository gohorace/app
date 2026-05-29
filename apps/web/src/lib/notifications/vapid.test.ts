import { describe, expect, it } from 'vitest'
import { vapidSubject } from './vapid'

describe('vapidSubject', () => {
  it('prefixes a bare email with mailto: (the HOR-296 failure case)', () => {
    expect(vapidSubject('hello@gohorace.com')).toBe('mailto:hello@gohorace.com')
  })

  it('passes a mailto: subject through untouched', () => {
    expect(vapidSubject('mailto:ops@gohorace.com')).toBe('mailto:ops@gohorace.com')
  })

  it('passes an https URL through untouched', () => {
    expect(vapidSubject('https://gohorace.com')).toBe('https://gohorace.com')
  })

  it('falls back to the support address when unset or blank', () => {
    expect(vapidSubject(undefined)).toBe('mailto:hello@gohorace.com')
    expect(vapidSubject('   ')).toBe('mailto:hello@gohorace.com')
  })

  it('trims surrounding whitespace before prefixing', () => {
    expect(vapidSubject('  hello@gohorace.com  ')).toBe('mailto:hello@gohorace.com')
  })
})
