import { describe, expect, it } from 'vitest'
import {
  extractSearchTerms,
  parseReply,
  groundReply,
  fallbackReply,
  buildGroundingBlock,
  type Grounding,
} from './companion'

const grounding: Grounding = {
  contacts: [
    { id: 'c-sarah', name: 'Sarah Thompson', email: 'sarah@example.com', score: 72, lastSeen: '2026-05-20' },
    { id: 'c-marcus', name: 'Marcus Bell', email: null, score: 40, lastSeen: null },
  ],
  lists: [{ id: 'l-watch', name: 'Watch closely' }],
  events: [],
  contextLabel: 'Digest',
}

describe('extractSearchTerms', () => {
  it('pulls the entity name out of a Contact: context label', () => {
    expect(extractSearchTerms('why now?', 'Contact: Sarah Thompson')).toContain('Sarah Thompson')
  })

  it('picks capitalised words from the prompt as likely names', () => {
    const terms = extractSearchTerms('Draft a follow-up for Marcus please', undefined)
    expect(terms).toContain('Marcus')
    expect(terms).not.toContain('for')
  })

  it('returns empty when there is nothing name-like', () => {
    expect(extractSearchTerms('who is active this week', undefined)).toEqual([])
  })
})

describe('parseReply', () => {
  it('parses a bare JSON object', () => {
    expect(parseReply('{"text":"hello"}').text).toBe('hello')
  })

  it('strips ```json fences', () => {
    expect(parseReply('```json\n{"text":"hi"}\n```').text).toBe('hi')
  })

  it('renders plain conversational prose as the reply text', () => {
    expect(parseReply("I'd be glad to help — who are you thinking about?").text).toBe(
      "I'd be glad to help — who are you thinking about?",
    )
  })

  it('extracts a JSON object embedded in surrounding prose', () => {
    expect(parseReply('Sure: {"text":"on it"} hope that helps').text).toBe('on it')
  })

  it('throws on empty or broken-JSON-fragment output', () => {
    expect(() => parseReply('{"italics":"x"}')).toThrow() // valid JSON, no text field
    expect(() => parseReply('{"text":"   "}')).toThrow() // empty text
    expect(() => parseReply('{ broken json')).toThrow() // looks like JSON, unparseable
    expect(() => parseReply('   ')).toThrow() // empty
  })
})

describe('groundReply — reference validation', () => {
  it('keeps references whose route is in the grounded set', () => {
    const msg = groundReply(
      { text: 'See her timeline.', references: [{ label: 'Open Sarah', route: '/contacts/c-sarah' }] },
      grounding,
    )
    expect(msg.references).toEqual([{ label: 'Open Sarah', route: '/contacts/c-sarah' }])
  })

  it('drops references to ids that were never provided', () => {
    const msg = groundReply(
      { text: 'x', references: [{ label: 'Ghost', route: '/contacts/c-ghost' }] },
      grounding,
    )
    expect(msg.references).toBeUndefined()
  })

  it('caps references at 3', () => {
    const msg = groundReply(
      {
        text: 'x',
        references: [
          { label: 'a', route: '/contacts/c-sarah' },
          { label: 'b', route: '/contacts/c-marcus' },
          { label: 'c', route: '/lists/l-watch' },
          { label: 'd', route: '/contacts/c-sarah' },
        ],
      },
      grounding,
    )
    expect(msg.references).toHaveLength(3)
  })
})

describe('groundReply — action validation', () => {
  it('keeps a valid draft-email contactId', () => {
    const msg = groundReply(
      { text: 'x', action: { kind: 'draft-email', target: 'Sarah', subject: 's', body: 'b', contactId: 'c-sarah' } },
      grounding,
    )
    expect(msg.action).toEqual({ kind: 'draft-email', target: 'Sarah', subject: 's', body: 'b', contactId: 'c-sarah' })
  })

  it('strips an invented contactId but keeps the action', () => {
    const msg = groundReply(
      { text: 'x', action: { kind: 'draft-email', target: 'Ghost', subject: 's', body: 'b', contactId: 'c-ghost' } },
      grounding,
    )
    expect(msg.action?.kind).toBe('draft-email')
    expect((msg.action as { contactId?: string }).contactId).toBeUndefined()
  })

  it('validates add-to-list ids independently', () => {
    const msg = groundReply(
      {
        text: 'x',
        action: { kind: 'add-to-list', target: 'Sarah', listName: 'Watch closely', contactId: 'c-sarah', listId: 'l-ghost' },
      },
      grounding,
    )
    expect(msg.action?.kind).toBe('add-to-list')
    expect((msg.action as { contactId?: string }).contactId).toBe('c-sarah')
    expect((msg.action as { listId?: string }).listId).toBeUndefined()
  })

  it('kebab-cases a create-inspection token', () => {
    const msg = groundReply(
      { text: 'x', action: { kind: 'create-inspection', target: '99 Buderim St', when: 'Sat 10am', token: 'Buderim Sat!' } },
      grounding,
    )
    expect((msg.action as { token?: string }).token).toBe('buderim-sat')
  })

  it('drops an unknown action kind', () => {
    const msg = groundReply({ text: 'x', action: { kind: 'delete-everything', target: 'all' } }, grounding)
    expect(msg.action).toBeUndefined()
  })

  it('drops a draft-email missing required fields', () => {
    const msg = groundReply({ text: 'x', action: { kind: 'draft-email', target: 'Sarah' } }, grounding)
    expect(msg.action).toBeUndefined()
  })
})

describe('fallbackReply', () => {
  it('names the top contact and links to them, with no action', () => {
    const msg = fallbackReply('who is hot', grounding)
    expect(msg.text).toContain('Sarah Thompson')
    expect(msg.references?.[0].route).toBe('/contacts/c-sarah')
    expect(msg.action).toBeUndefined()
  })

  it('returns a safe generic message when there are no contacts', () => {
    const msg = fallbackReply('who is hot', { ...grounding, contacts: [] })
    expect(msg.references).toBeUndefined()
    expect(msg.action).toBeUndefined()
    expect(msg.text.length).toBeGreaterThan(0)
  })
})

describe('buildGroundingBlock — conversation history', () => {
  it('renders prior turns + the latest message when history is present', () => {
    const block = buildGroundingBlock(grounding, 'and the sale on his street?', [
      { role: 'agent', text: 'draft a follow-up for Brian' },
      { role: 'horace', text: "what's your angle?" },
    ])
    expect(block).toContain('CONVERSATION SO FAR')
    expect(block).toContain('Agent: draft a follow-up for Brian')
    expect(block).toContain("Horace: what's your angle?")
    expect(block).toContain("The agent's latest message: and the sale on his street?")
  })

  it('omits the conversation section when history is empty', () => {
    const block = buildGroundingBlock(grounding, 'hi', [])
    expect(block).not.toContain('CONVERSATION SO FAR')
    expect(block).toContain("The agent's latest message: hi")
  })
})
