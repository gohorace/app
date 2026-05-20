import { describe, expect, it } from 'vitest'
import {
  actionConfirmation,
  emptyConversation,
  greet,
  initialMessages,
  respond,
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

describe('respond — pattern matcher', () => {
  it('"set up an inspection" surfaces a create-inspection action', () => {
    const r = respond('Set up an inspection')
    expect(r.action?.kind).toBe('create-inspection')
  })

  it('"draft something for marcus" surfaces a draft-email targeted at Marcus', () => {
    const r = respond('Draft a follow-up for Marcus')
    expect(r.action?.kind).toBe('draft-email')
    if (r.action?.kind === 'draft-email') {
      expect(r.action.target).toMatch(/Marcus/)
    }
  })

  it('"add to watch closely" surfaces an add-to-list action', () => {
    // Note: the pattern matcher is first-match-wins. "Sarah" is matched
    // earlier than "add", so the prompt has to avoid that name to land
    // on this branch. The branch fires on "add … list" or "add … watch".
    const r = respond('Add them to my watch list')
    expect(r.action?.kind).toBe('add-to-list')
  })

  it('"dismiss" surfaces a dismiss action', () => {
    const r = respond('Dismiss this signal')
    expect(r.action?.kind).toBe('dismiss')
  })

  it('falls back to the "still learning" message when nothing matches', () => {
    const r = respond('What is the weather like in Tokyo?')
    expect(r.action).toBeUndefined()
    expect(r.text).toMatch(/still learning/i)
  })

  it('Sarah-named prompt returns italics + references (no action)', () => {
    const r = respond('Why is Sarah on my digest?')
    expect(r.action).toBeUndefined()
    expect(r.italics).toBeDefined()
    expect(r.references?.length).toBeGreaterThan(0)
    expect(r.references?.[0].route).toMatch(/^\//)
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
