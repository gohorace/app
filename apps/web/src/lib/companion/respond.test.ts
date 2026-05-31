import { describe, expect, it } from 'vitest'
import {
  actionConfirmation,
  emptyConversation,
  focusedConversation,
  greet,
  initialMessages,
  suggestedPrompts,
} from './respond'
import type { CompanionSignalContext } from './types'

const knownSignal: CompanionSignalContext = {
  contactId: 'c-sarah',
  name: 'Sarah Thompson',
  read: 'She keeps circling the Paddington terraces — quietly serious.',
  identity: 'known',
  suburb: 'Paddington, NSW',
}

const anonSignal: CompanionSignalContext = {
  contactId: 'anon-1',
  name: 'A returning visitor',
  read: 'Third visit this week, always the same two listings.',
  identity: 'anonymous',
  suburb: 'Noosaville, QLD',
}

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

  it('the general "On your activity" label reuses the morning greeting', () => {
    expect(greet('On your activity · Wednesday, 13 May')).toMatch(/Morning/)
  })

  it('a focused known signal greets by first name only', () => {
    const g = greet('On Sarah Thompson', knownSignal)
    expect(g).toContain('Sarah')
    expect(g).not.toContain('Thompson')
  })

  it('a focused anonymous signal greets without a name', () => {
    const g = greet('On this signal', anonSignal)
    expect(g).toMatch(/this signal/)
    expect(g).not.toContain('returning visitor')
  })
})

describe('focusedConversation', () => {
  it('is a single Horace turn that seeds the read as the italic follow-on', () => {
    const msgs = focusedConversation(knownSignal, 'On Sarah Thompson')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].kind).toBe('horace')
    expect((msgs[0] as { italics?: string }).italics).toBe(knownSignal.read)
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

  it('"On your activity" reuses the general digest chips', () => {
    expect(suggestedPrompts('On your activity · Wed, 13 May')).toEqual(suggestedPrompts('Digest'))
  })

  it('a focused known signal offers a draft / why-now / list chip set', () => {
    const prompts = suggestedPrompts('On Sarah Thompson', knownSignal)
    expect(prompts[0]).toContain('Sarah')
    expect(prompts).toContain('Why now?')
  })

  it('a focused anonymous signal offers identity / suburb / watch chips', () => {
    const prompts = suggestedPrompts('On this signal', anonSignal)
    expect(prompts.some((p) => p.includes('Noosaville'))).toBe(true)
    expect(prompts.some((p) => /watch/i.test(p))).toBe(true)
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
