import Anthropic from '@anthropic-ai/sdk'

export interface ContactEvent {
  event_type: string
  properties: Record<string, unknown>
  score_delta: number
  occurred_at: string
}

export interface ContactInsight {
  why_now: string   // 1–2 sentences: what they did and why it matters
  action: string    // specific recommended action for the agent
}

export interface LeadWithInsight {
  contact_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  score: number
  score_change: number
  last_seen_at: string | null
  insight: ContactInsight
}

/**
 * Generates a why_now + action insight for a single contact
 * based on their recent events. Returns a fallback if AI is unavailable.
 */
export async function generateContactInsight(
  client: Anthropic,
  contact: {
    first_name: string | null
    last_name: string | null
    email: string | null
    score: number
    score_change: number
    last_seen_at: string | null
  },
  recentEvents: ContactEvent[],
): Promise<ContactInsight> {
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email || 'this contact'

  // Summarise events into a readable list
  const eventLines = recentEvents
    .slice(0, 10) // cap context length
    .map((e) => {
      const props = e.properties
      const detail =
        e.event_type === 'page_view'      ? `viewed page: ${props.path ?? props.url ?? ''}` :
        e.event_type === 'property_view'  ? `viewed property: ${props.address ?? props.property_id ?? ''}` :
        e.event_type === 'form_submit'    ? `submitted form: ${props.form_id ?? props.form_name ?? 'enquiry'}` :
        e.event_type === 'return_visit'   ? 'returned to the website' :
        e.event_type === 'campaign_click' ? `clicked campaign email` :
        e.event_type === 'scroll_depth'   ? `read ${props.pct ?? ''}% of a page` :
        e.event_type
      const when = new Date(e.occurred_at).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
      return `- ${when}: ${detail}`
    })
    .join('\n')

  const prompt = `You are writing a concise intelligence brief for a real estate agent named Matt.

Contact: ${name}${contact.email ? ` (${contact.email})` : ''}
Lead score: ${contact.score} (${contact.score_change > 0 ? `+${contact.score_change}` : contact.score_change} this week)
Last seen: ${contact.last_seen_at ? new Date(contact.last_seen_at).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : 'unknown'}

Recent activity:
${eventLines || '- No recent events'}

Write two things:
1. why_now: 1–2 sentences explaining why this person deserves attention right now. Be specific about what they did. Be direct, no fluff.
2. action: one specific action Matt should take — e.g. "Call ${name} today and ask if they're still thinking of selling." Be concrete.

Respond in JSON only:
{"why_now": "...", "action": "..."}`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const parsed = JSON.parse(text) as { why_now: string; action: string }

    return {
      why_now: parsed.why_now ?? fallback(name).why_now,
      action:  parsed.action  ?? fallback(name).action,
    }
  } catch (err) {
    console.error(`[briefing-ai] Failed to generate insight for ${name}:`, err)
    return fallback(name)
  }
}

function fallback(name: string): ContactInsight {
  return {
    why_now: `${name} has been active on your website recently.`,
    action:  `Follow up with ${name} to check in.`,
  }
}
