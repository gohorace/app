import { describe, it, expect } from 'vitest'
import {
  signWebhookBody,
  webhookSignatureHeader,
  nextBackoffMs,
  mintWebhookSecret,
  isWebhookEvent,
} from './webhooks'

describe('signWebhookBody', () => {
  it('is deterministic 64-hex and sensitive to every input', () => {
    const a = signWebhookBody('secret', 123, 'body')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(signWebhookBody('secret', 123, 'body')).toBe(a)
    expect(signWebhookBody('other', 123, 'body')).not.toBe(a)
    expect(signWebhookBody('secret', 124, 'body')).not.toBe(a)
    expect(signWebhookBody('secret', 123, 'body2')).not.toBe(a)
  })
})

describe('webhookSignatureHeader', () => {
  it('formats t=,v1= and verifies the way a receiver would', () => {
    const body = '{"a":1}'
    const header = webhookSignatureHeader('shh', body, 1_700_000_000_000)
    expect(header).toBe(`t=1700000000,v1=${signWebhookBody('shh', 1700000000, body)}`)

    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header)
    expect(m).not.toBeNull()
    const t = Number(m![1])
    expect(signWebhookBody('shh', t, body)).toBe(m![2])
  })
})

describe('nextBackoffMs', () => {
  it('follows 1m/5m/30m/2h/12h then exhausts', () => {
    expect(nextBackoffMs(1)).toBe(60_000)
    expect(nextBackoffMs(2)).toBe(300_000)
    expect(nextBackoffMs(3)).toBe(1_800_000)
    expect(nextBackoffMs(4)).toBe(7_200_000)
    expect(nextBackoffMs(5)).toBe(43_200_000)
    expect(nextBackoffMs(6)).toBeNull()
    expect(nextBackoffMs(7)).toBeNull()
  })
})

describe('mintWebhookSecret / isWebhookEvent', () => {
  it('mints a unique whsec_ secret', () => {
    const s = mintWebhookSecret()
    expect(s.startsWith('whsec_')).toBe(true)
    expect(s).not.toBe(mintWebhookSecret())
  })
  it('validates event names', () => {
    expect(isWebhookEvent('contact.created')).toBe(true)
    expect(isWebhookEvent('relationship.updated')).toBe(true)
    expect(isWebhookEvent('contact.deleted')).toBe(false)
  })
})
