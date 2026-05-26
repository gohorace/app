import { describe, expect, it } from 'vitest'
import {
  actionConfirmation,
  emptyConversation,
  greet,
  initialMessages,
  suggestedPrompts,
} from './respond'

describe('greet', () => {
  it('Digest + undefined fall through the same morning greeting', () => {
    expect(greet(undefined)).toMatch(/Morning/)
    expect(greet('Digest')).toMatch(/Morning/)
  })

  it('Contact: prefix names the entity in the greeting', () => {
    expect(greet('Contact: Sarah Thompson')).toContain('Sarah Thompson')
    expect(greet('Contact: Sarah Thompson')).not.toContain('Contact:')
  })

  it('Property: and Inspection: prefixes get their own openers', () => {
    expect(greet('Property: 47 Maple Street')).toMatch(/address open/i)
    expect(greet('Inspection: Buderim Saturday')).toMatch(/Inspection/i)
  })

  it('falls back to "I\'m on {label}" for unknown contexts', () => {
    expect(greet('Market')).toMatch(/I'm on Market/)
  })
})

describe('initialMessages / emptyConversation', () => {
  it('initialMessages renders greeting + agent prompt in order', () => {
    const msgs = initialMessages('Why is Sarah on my digest?', 'Digest')
    expect(msgs).toHaveLength(2)
    expect(msgs[0].kind).toBe('horace')
    expect(msgs[1].kind).toBe('agent')
    expect(msgs[1].text).toBe('Why is Sarah on my digest?')
  })

  it('emptyConversation is just the greeting', () => {
    const msgs = emptyConversation('Inspections')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].kind).toBe('horace')
  })
})

describe('suggestedPrompts', () => {
  it('returns three prompts on Digest', () => {
    expect(suggestedPrompts('Digest')).toHaveLength(3)
  })

  it('Contact: prefix interpolates the first name', () => {
    const prompts = suggestedPrompts('Contact: Sarah Thompson')
    expect(prompts[0]).toContain('Sarah')
    expect(prompts[0]).not.toContain('Thompson')
  })

  it('Market gets market-specific prompts', () => {
    const prompts = suggestedPrompts('Market')
    expect(prompts.some((p) => p.toLowerCase().includes('suburb'))).toBe(true)
  })

  it('falls back to a single generic prompt for unknown contexts', () => {
    const prompts = suggestedPrompts('SomethingNew')
    expect(prompts).toHaveLength(1)
  })
})

describe('actionConfirmation', () => {
  it('add-to-list confirmation interpolates target + listName', () => {
    const text = actionConfirmation({
      kind: 'add-to-list',
      target: 'Sarah Thompson',
      listName: 'Watch closely',
    })
    expect(text).toContain('Sarah Thompson')
    expect(text).toContain('Watch closely')
  })

  it('create-inspection mentions Inspections', () => {
    expect(
      actionConfirmation({
        kind: 'create-inspection',
        target: '99 Buderim St',
        when: 'Saturday 10am',
        token: 'buderim-sat',
      }),
    ).toMatch(/Inspections/)
  })

  it('dismiss + draft-email each return a single sentence', () => {
    expect(
      actionConfirmation({ kind: 'dismiss', target: 'this signal' }),
    ).toMatch(/Dismissed/)
    expect(
      actionConfirmation({
        kind: 'draft-email',
        target: 'Marcus',
        subject: 'x',
        body: 'y',
      }),
    ).toMatch(/drafts/)
  })
})
