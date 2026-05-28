import { describe, it, expect } from 'vitest'
import {
  parseLimit,
  parseTimestamp,
  parseEnum,
  encodeCursor,
  decodeCursor,
  cursorOrExpr,
  sliceCursor,
} from './cursor'
import { ApiError } from './respond'

describe('parseLimit', () => {
  it('defaults to 100 and clamps to 200', () => {
    expect(parseLimit(null)).toBe(100)
    expect(parseLimit('')).toBe(100)
    expect(parseLimit('50')).toBe(50)
    expect(parseLimit('999')).toBe(200)
  })
  it('rejects non-positive / non-integer', () => {
    expect(() => parseLimit('0')).toThrow(ApiError)
    expect(() => parseLimit('-3')).toThrow(ApiError)
    expect(() => parseLimit('abc')).toThrow(ApiError)
    expect(() => parseLimit('1.5')).toThrow(ApiError)
  })
})

describe('parseTimestamp', () => {
  it('passes valid ISO through; undefined when absent', () => {
    expect(parseTimestamp(null, 'updated_since')).toBeUndefined()
    expect(parseTimestamp('2026-05-19T04:23:00Z', 'updated_since')).toBe('2026-05-19T04:23:00Z')
  })
  it('throws on garbage', () => {
    expect(() => parseTimestamp('not-a-date', 'updated_since')).toThrow(ApiError)
  })
})

describe('parseEnum', () => {
  const allowed = ['a', 'b'] as const
  it('validates membership', () => {
    expect(parseEnum(null, allowed, 'x')).toBeUndefined()
    expect(parseEnum('a', allowed, 'x')).toBe('a')
    expect(() => parseEnum('c', allowed, 'x')).toThrow(ApiError)
  })
})

describe('cursor encode/decode', () => {
  it('round-trips', () => {
    const c = encodeCursor('2026-05-19T04:23:00Z', '11111111-2222-4333-8444-555566667777')
    const d = decodeCursor(c)
    expect(d).toEqual({ t: '2026-05-19T04:23:00Z', id: '11111111-2222-4333-8444-555566667777' })
  })
  it('returns null for garbage', () => {
    expect(decodeCursor('not-base64!')).toBeNull()
    expect(decodeCursor(Buffer.from('{}', 'utf8').toString('base64url'))).toBeNull()
  })
})

describe('cursorOrExpr', () => {
  it('is null without a cursor', () => {
    expect(cursorOrExpr('updated_at', null)).toBeNull()
  })
  it('builds the keyset expression', () => {
    const c = encodeCursor('2026-05-19T04:23:00Z', 'abc')
    expect(cursorOrExpr('updated_at', c)).toBe(
      'updated_at.gt.2026-05-19T04:23:00Z,and(updated_at.eq.2026-05-19T04:23:00Z,id.gt.abc)',
    )
  })
  it('throws on a malformed cursor', () => {
    expect(() => cursorOrExpr('updated_at', 'garbage')).toThrow(ApiError)
  })
})

describe('sliceCursor', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, updated_at: `t-${i}` }))

  it('returns no cursor when the page is not full', () => {
    const { rows: page, nextCursor } = sliceCursor(rows(3), 5, 'updated_at')
    expect(page).toHaveLength(3)
    expect(nextCursor).toBeNull()
  })
  it('trims the over-fetched row and emits a cursor', () => {
    const { rows: page, nextCursor } = sliceCursor(rows(6), 5, 'updated_at')
    expect(page).toHaveLength(5)
    expect(nextCursor).not.toBeNull()
    expect(decodeCursor(nextCursor as string)).toEqual({ t: 't-4', id: 'id-4' })
  })
  it('handles null input', () => {
    expect(sliceCursor(null, 5, 'updated_at')).toEqual({ rows: [], nextCursor: null })
  })
})
