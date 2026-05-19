/**
 * Horace companion — conversation brain (v2.0).
 *
 * Ports the prototype's `greet` + `respondTo` + `suggestedPrompts` +
 * `actionConfirmation` from `companion.jsx` verbatim. v2.0 ships this as
 * a pure-client pattern matcher — fast, deterministic, demo-aware. v2.x
 * swaps the body of `respond()` for a real Anthropic call without
 * consumers (drawer, action handlers) changing.
 *
 * Voice rules (from the v2 handoff README): third person, no emoji, no
 * exclamation, em-dashes for rhythm. Keep that in mind editing strings.
 */

import type {
  CompanionAction,
  CompanionMessage,
  HoraceMessage,
} from './types'

// ── Greeting ────────────────────────────────────────────────────────────────

export function greet(contextLabel: string | undefined): string {
  if (!contextLabel || contextLabel === 'Digest') {
    return 'Morning. What do you need to know?'
  }
  if (contextLabel.startsWith('Contact:')) {
    return `I'm looking at ${contextLabel.replace('Contact: ', '')} with you. What do you need?`
  }
  if (contextLabel.startsWith('Property:')) {
    return `I have the address open. Ask me what's moved.`
  }
  if (contextLabel.startsWith('Inspection:')) {
    return `Inspection in view. Want me to draft anyone in particular?`
  }
  return `I'm on ${contextLabel}. What's the question?`
}

// ── Initial / empty conversation builders ───────────────────────────────────

export function initialMessages(
  prompt: string,
  contextLabel: string | undefined,
): CompanionMessage[] {
  return [
    { kind: 'horace', text: greet(contextLabel) },
    { kind: 'agent', text: prompt },
  ]
}

export function emptyConversation(
  contextLabel: string | undefined,
): CompanionMessage[] {
  return [{ kind: 'horace', text: greet(contextLabel) }]
}

// ── Response (pattern-matched mock; LLM call lives here in v2.x) ─────────────

export function respond(
  prompt: string,
  _contextLabel?: string | undefined,
): HoraceMessage {
  const p = prompt.toLowerCase()

  if (
    p.includes('inspection') &&
    (p.includes('set up') ||
      p.includes('schedule') ||
      p.includes('create') ||
      p.includes('new'))
  ) {
    return {
      kind: 'horace',
      text: "I'll set the bones — 99 Buderim St, Saturday 10am. I've generated the QR token and pre-tagged it 'Buderim Sat'. Confirm and I'll publish.",
      action: {
        kind: 'create-inspection',
        target: '99 Buderim St, Currimundi',
        when: 'Saturday 10:00 am',
        token: 'buderim-sat',
      },
    }
  }

  if (p.includes('sarah')) {
    return {
      kind: 'horace',
      text: 'Sarah Thompson is here because she returned to 47 Maple a third time this week — Tuesday at lunch, Wednesday morning, and again two hours ago. Each visit, she paused on the floor plan and scrolled past sold prices in the neighbourhood.',
      italics:
        'That pattern usually means a private appraisal in their head. A call lands well here.',
      references: [
        { label: 'Open 47 Maple Street', route: '/properties/47-maple' },
        { label: 'See full timeline', route: '/contacts/sarah-thompson' },
      ],
    }
  }

  if (p.includes('draft') && p.includes('marcus')) {
    return {
      kind: 'horace',
      text: "Here's a soft-touch draft — referencing his two-property morning without spooking him.",
      action: {
        kind: 'draft-email',
        target: 'Marcus Bell',
        subject: 'Two places caught your eye',
        body: 'Hi Marcus — saw you spent some time on 1049 Eenie Creek and 604 Embelia this morning. Different vibes, both solid. Happy to talk through either if it would help, no pressure either way. — A.',
      },
    }
  }

  if (p.includes('draft')) {
    return {
      kind: 'horace',
      text: "I've drafted something measured — it leaves them the next move.",
      action: {
        kind: 'draft-email',
        target: 'this contact',
        subject: 'A quick note',
        body: "Hi — saw you've been spending time on the listing. No reply needed, but if there's anything I can answer, I'm a phone call away. — A.",
      },
    }
  }

  if (p.includes('add') && (p.includes('list') || p.includes('watch'))) {
    return {
      kind: 'horace',
      text: 'Adding to Watch closely — she meets the criteria (three named visits, intent above 50).',
      action: {
        kind: 'add-to-list',
        target: 'Sarah Thompson',
        listName: 'Watch closely',
      },
    }
  }

  if (p.includes('paddington')) {
    return {
      kind: 'horace',
      text: 'Three named contacts have been active in Paddington this week: Sarah Thompson, an anonymous returning visitor on 47 Maple, and a quick session by Marcus Bell on Sunday. Sarah is the warmest by some distance.',
      references: [{ label: 'See contacts in Paddington', route: '/contacts' }],
    }
  }

  if (p.includes('changed') || p.includes('47 maple')) {
    return {
      kind: 'horace',
      text: 'On 47 Maple: 17 sessions in the last week, 3 of them named. Sarah accounts for half the named time. One new anonymous visitor pattern building — someone in Brisbane returning twice.',
      references: [{ label: 'Open 47 Maple', route: '/properties/47-maple' }],
    }
  }

  if (p.includes('buderim') || p.includes('follow-up')) {
    return {
      kind: 'horace',
      text: 'Three sign-ins from Buderim are still active. I can draft each separately — same skeleton, tailored per person.',
      action: {
        kind: 'draft-email',
        target: '3 still-active sign-ins from Buderim',
        subject: 'Saturday at Buderim',
        body: 'Hi {name} — thanks for swinging by Saturday. Saw you took another look at the listing earlier this week. Any questions about the place or the area, just say. — A.',
      },
    }
  }

  if (p.includes('dismiss')) {
    return {
      kind: 'horace',
      text: 'Noted. Moving on.',
      action: { kind: 'dismiss', target: 'this signal' },
    }
  }

  return {
    kind: 'horace',
    text: "I'm still learning the shape of this question. In the meantime — try asking me about a specific contact, property, or inspection, and I'll pull what I'm seeing.",
  }
}

// ── Suggested prompts (context-aware chips when conversation is empty) ──────

export function suggestedPrompts(contextLabel: string | undefined): string[] {
  if (!contextLabel || contextLabel === 'Digest') {
    return [
      'Why is Sarah on my digest?',
      'Draft a follow-up for Marcus',
      'Who in Paddington is active?',
    ]
  }
  if (contextLabel.startsWith('Contact:')) {
    const name = contextLabel.replace('Contact: ', '')
    const first = name.split(' ')[0]
    return [`Why is ${first} stirring?`, 'Draft a soft follow-up', 'Add to Watch closely']
  }
  if (contextLabel.startsWith('Property:')) {
    return [
      'What changed here this week?',
      `Who's the most active visitor?`,
      'Draft an off-market enquiry',
    ]
  }
  if (contextLabel.startsWith('Inspection:')) {
    return [
      'Draft follow-up to still-active',
      'Who converted into pipeline?',
      `Compare to last week's open`,
    ]
  }
  if (contextLabel === 'Inspections') {
    return [
      'Set up an inspection',
      'Draft follow-up to recent sign-ins',
      'Which inspection converted best?',
    ]
  }
  if (contextLabel === 'Market') {
    return [
      'Where is activity concentrating?',
      'Which suburb is warming?',
      'Anyone new in Noosaville?',
    ]
  }
  return ['What can you help me with?']
}

// ── Post-confirm system message text ────────────────────────────────────────

export function actionConfirmation(action: CompanionAction): string {
  switch (action.kind) {
    case 'draft-email':
      return `Saved to drafts. I'll keep an eye on whether they open it.`
    case 'add-to-list':
      return `Done. ${action.target} is in ${action.listName}.`
    case 'dismiss':
      return `Dismissed. I'll resurface them if something changes.`
    case 'create-inspection':
      return `Scheduled. QR is ready in Inspections.`
  }
}
