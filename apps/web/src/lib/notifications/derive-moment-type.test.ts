import { describe, expect, it } from 'vitest'
import { deriveMomentType } from './derive-moment-type'

function row(type: string, sentAt = '2026-05-14T10:00:00+10:00') {
  return { id: 'n1', type, sent_at: sentAt, contact_id: 'c1' }
}

describe('deriveMomentType', () => {
  it('returns high_intent for form-related types', () => {
    for (const t of ['alert_form_submit', 'alert_form', 'sms_form']) {
      expect(deriveMomentType(row(t))).toBe('high_intent')
    }
  })

  it('returns high_intent for score-threshold types', () => {
    for (const t of ['alert_score_threshold', 'alert_threshold', 'sms_threshold']) {
      expect(deriveMomentType(row(t))).toBe('high_intent')
    }
  })

  // HOR-280 — these were counted toward the bell badge but, without a mapping,
  // never rendered in the stream, so the badge over-counted.
  it('returns newly_known for Doorstep capture + embed alerts', () => {
    for (const t of ['alert_inspection_capture', 'alert_embed_capture']) {
      expect(deriveMomentType(row(t))).toBe('newly_known')
    }
  })

  it('returns returning for inspection revisit', () => {
    expect(deriveMomentType(row('alert_inspection_revisit'))).toBe('returning')
  })

  it('returns newly_known for return-visit when identified <24h before send', () => {
    const sent = '2026-05-14T10:00:00+10:00'
    const identified = '2026-05-14T01:00:00+10:00' // 9h before
    expect(deriveMomentType(row('alert_return_visit', sent), { identified_at: identified })).toBe(
      'newly_known',
    )
  })

  it('returns returning for return-visit when identified >24h before send', () => {
    const sent = '2026-05-14T10:00:00+10:00'
    const identified = '2026-05-12T10:00:00+10:00' // 48h before
    expect(deriveMomentType(row('alert_return_visit', sent), { identified_at: identified })).toBe(
      'returning',
    )
  })

  it('returns returning for return-visit on a contact with no identified_at', () => {
    expect(deriveMomentType(row('alert_return_visit'), { identified_at: null })).toBe('returning')
  })

  it('returns null for audit / email types', () => {
    for (const t of ['email_briefing', 'email_daily_brief', 'volume_review', 'email_workspace_invite']) {
      expect(deriveMomentType(row(t))).toBeNull()
    }
  })

  it('returns null when contact_id is missing (Slice A: contact-only)', () => {
    const r = { id: 'n1', type: 'alert_form_submit', sent_at: '2026-05-14T10:00:00+10:00', contact_id: null }
    expect(deriveMomentType(r)).toBeNull()
  })
})
