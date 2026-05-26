/**
 * Horace companion — conversation client + static helpers.
 *
 * The brain is now server-side: `requestReply` POSTs to
 * `/api/companion/respond` (HOR-271), which retrieves a workspace-scoped
 * slice of the agent's data and returns a grounded `HoraceMessage`. This
 * replaces the v2.0 pattern-matched mock — the Anthropic key stays on the
 * server and every link/action id in the reply is real.
 *
 * The greeting, suggested-prompt chips, and post-confirm copy stay
 * client-side and static (ported from the prototype's `companion.jsx`).
 *
 * Voice rules (from the v2 handoff README): first person to the agent,
 * third person about contacts, no emoji, no exclamation, em-dashes for
 * rhythm.
 */

import type { CompanionAction, CompanionMessage, ConversationTurn, HoraceMessage } from './types'

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

// ── Response (server-backed brain) ───────────────────────────────────────────

const UNREACHABLE: HoraceMessage = {
  kind: 'horace',
  text: "I couldn't reach my notes just now — try me again in a moment.",
}

/**
 * Ask the server-side brain for a grounded reply. Always resolves to a
 * `HoraceMessage` — on any network/parse failure it returns a soft
 * "couldn't reach" message rather than throwing, so the drawer can render
 * it like any other turn.
 */
export async function requestReply(
  prompt: string,
  contextLabel: string | undefined,
  history: ConversationTurn[] = [],
): Promise<HoraceMessage> {
  try {
    const res = await fetch('/api/companion/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, contextLabel: contextLabel ?? null, history }),
    })
    if (!res.ok) return UNREACHABLE
    const data = (await res.json()) as Partial<HoraceMessage>
    if (data?.kind === 'horace' && typeof data.text === 'string' && data.text.trim()) {
      return data as HoraceMessage
    }
    return UNREACHABLE
  } catch {
    return UNREACHABLE
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
