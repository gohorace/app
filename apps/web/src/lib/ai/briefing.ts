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
  agentName: string,
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
  const agentFirst = agentName.split(' ')[0] || agentName

  const eventLines = recentEvents
    .slice(0, 10)
    .map((e) => {
      const props = e.properties
      const detail =
        e.event_type === 'page_view'      ? `viewed page: ${props.path ?? props.url ?? ''}` :
        e.event_type === 'property_view'  ? `viewed property: ${props.address ?? props.property_id ?? ''}` :
        e.event_type === 'form_submit'    ? `submitted form: ${props.form_id ?? props.form_name ?? 'enquiry'}` :
        e.event_type === 'return_visit'   ? 'returned to the website' :
        e.event_type === 'scroll_depth'   ? `read ${props.pct ?? ''}% of a page` :
        e.event_type
      const when = new Date(e.occurred_at).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
      return `- ${when}: ${detail}`
    })
    .join('\n')

  const prompt = `You are writing a concise intelligence brief for a real estate agent named ${agentFirst}.

Contact: ${name}${contact.email ? ` (${contact.email})` : ''}
Lead score: ${contact.score} (${contact.score_change > 0 ? `+${contact.score_change}` : contact.score_change} this week)
Last seen: ${contact.last_seen_at ? new Date(contact.last_seen_at).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : 'unknown'}

Recent activity:
${eventLines || '- No recent events'}

Write two things:
1. why_now: 1–2 sentences explaining why this person deserves attention right now. Be specific about what they did. Be direct, no fluff.
2. action: one specific action ${agentFirst} should take — e.g. "Call ${name} today and ask if they're still thinking of selling." Be concrete.

Respond in JSON only:
{"why_now": "...", "action": "..."}`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text : ''
    const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(text) as { why_now: string; action: string }

    return {
      why_now: parsed.why_now ?? fallbackInsight(name).why_now,
      action:  parsed.action  ?? fallbackInsight(name).action,
    }
  } catch (err) {
    console.error(`[briefing-ai] Failed to generate insight for ${name}:`, err)
    return fallbackInsight(name)
  }
}

/**
 * Generates a short Horace-voiced narrative intro for the briefing email,
 * summarising the day's lead activity in 2–3 punchy sentences.
 */
export async function generateBriefingNarrative(
  client: Anthropic,
  agentName: string,
  leads: Array<{
    first_name: string | null
    last_name: string | null
    score: number
    score_change: number
    topEventType?: string | null
  }>,
  windowLabel: 'today' | 'this week',
): Promise<string> {
  if (leads.length === 0) {
    return `Quiet ${windowLabel}. Horace is watching.`
  }

  const agentFirst = agentName.split(' ')[0] || agentName
  const leadLines = leads.map((l) => {
    const name = [l.first_name, l.last_name].filter(Boolean).join(' ') || 'A contact'
    const event = l.topEventType === 'form_submit'
      ? 'submitted a form'
      : l.topEventType === 'return_visit'
        ? 'came back'
        : l.topEventType === 'property_view'
          ? 'viewed a listing'
          : 'was active'
    return `${name} (score ${l.score}, ${event})`
  }).join('; ')

  const prompt = `You are Horace — a quiet, intelligent real estate market intelligence system.
Write 2–3 sentences summarising ${windowLabel}'s lead activity for ${agentFirst}.

Leads ${windowLabel}: ${leadLines}

Rules:
- No greeting, no "Hi ${agentFirst}". Just the intelligence.
- Confident, brief, slightly poetic. Write like a trusted advisor, not a dashboard.
- Name the 1–2 most notable contacts and what they did.
- End with a sense of what the agent should do with this information.
- Under 60 words.

Example style: "Three contacts stirred today. Emma's been back twice — something's shifting. Tom raised his hand with a form. The moment is yours."

Respond with the narrative text only, no JSON, no quotes.`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 128,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    return text || fallbackNarrative(leads.length, windowLabel)
  } catch {
    return fallbackNarrative(leads.length, windowLabel)
  }
}

function fallbackInsight(name: string): ContactInsight {
  return {
    why_now: `${name} has been active on your website recently.`,
    action:  `Follow up with ${name} to check in.`,
  }
}

function fallbackNarrative(count: number, windowLabel: string): string {
  return `${count} contact${count === 1 ? '' : 's'} worth your attention ${windowLabel}. Horace has been watching.`
}
