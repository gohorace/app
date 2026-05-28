import { describe, it, expect } from 'vitest'
import { encodeId, decodeId } from './ids'

const UUIDS = [
  '8f3k2j1h-0000-4000-8000-000000000000'.replace(/[^0-9a-f-]/g, '0'), // sanitised below
  '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '2k9d4f7b-1234-4abc-89ef-0123456789ab'.replace(/[^0-9a-f-]/g, '0'),
  '11111111-2222-4333-8444-555566667777',
  '0000000a-0000-0000-0000-000000000000', // leading-zero stress
]

describe('encodeId / decodeId', () => {
  it('round-trips every prefix', () => {
    for (const u of UUIDS) {
      for (const p of ['con', 'prp', 'rel'] as const) {
        const enc = encodeId(p, u)
        expect(enc.startsWith(`${p}_`)).toBe(true)
        expect(decodeId(p, enc)).toBe(u)
      }
    }
  })

  it('is collision-free and prefix-distinct for the same uuid', () => {
    const u = '11111111-2222-4333-8444-555566667777'
    const c = encodeId('con', u)
    const p = encodeId('prp', u)
    expect(c).not.toBe(p)
    // A con_ id must not decode under the prp_ prefix.
    expect(decodeId('prp', c)).toBeNull()
  })

  it('rejects the wrong prefix', () => {
    const id = encodeId('con', '11111111-2222-4333-8444-555566667777')
    expect(decodeId('rel', id)).toBeNull()
  })

  it('rejects garbage, empty, and out-of-range bodies', () => {
    expect(decodeId('con', 'con_')).toBeNull()
    expect(decodeId('con', 'con_!!!')).toBeNull()
    expect(decodeId('con', 'nope')).toBeNull()
    expect(decodeId('con', '')).toBeNull()
    // 33 'z' chars decodes to > 128 bits → rejected.
    expect(decodeId('con', 'con_' + 'z'.repeat(40))).toBeNull()
  })
})
