import { describe, it, expect } from 'vitest'
import { pickSurfacedMoment, type SurfacedRow } from './property-surfaced'

const tagged: SurfacedRow = { id: 'tag-1', sent_at: '2026-05-30T10:00:00.000Z' }
const fallback: SurfacedRow = { id: 'fb-1', sent_at: '2026-06-01T09:00:00.000Z' }

describe('pickSurfacedMoment', () => {
  it('prefers the property-tagged row even when the fallback is more recent', () => {
    expect(pickSurfacedMoment(tagged, fallback)).toEqual({ id: 'tag-1', sentAt: tagged.sent_at })
  })

  it('uses the contact fallback when there is no tagged row', () => {
    expect(pickSurfacedMoment(null, fallback)).toEqual({ id: 'fb-1', sentAt: fallback.sent_at })
  })

  it('returns the tagged row when there is no fallback', () => {
    expect(pickSurfacedMoment(tagged, null)).toEqual({ id: 'tag-1', sentAt: tagged.sent_at })
  })

  it('returns null when neither source has a moment', () => {
    expect(pickSurfacedMoment(null, null)).toBeNull()
  })
})
