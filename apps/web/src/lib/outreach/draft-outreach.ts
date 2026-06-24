/**
 * Outreach draft generation — HOR-388 (P4).
 *
 * Produces the three drafts a nudge offers — email, SMS, call notes — grounded
 * in the agent's own matched site content (P3 matchContentForContact) and a
 * truthful pretext (signal-draft.ts), all lead-facing surfaces cleared by the
 * Invisible Signal Rule firewall.
 *
 * One Haiku call returns subject/body/sms/call_opener together (consistent
 * voice, one round-trip); every lead-facing field is run through
 * findBannedPhrase (extended here to SMS + the spoken call opener), with one
 * corrective retry then drop — same contract as the digest path.
 *
 * The call-notes REFERENCE CONTEXT is the one place that's deliberately
 * explicit about the signal: it's internal, agent-facing only, and templated
 * (never model-generated lead copy) — that's where Horace earns the agent's
 * trust.
 */

import Anthropic from '@anthropic-ai/sdk'
import { unstable_cache } from 'next/cache'
import { findBannedPhrase, type SignalPretext, type AgentVoice } from '@/lib/ai/signal-draft'
import type { MatchResult, MatchSlot, ContentCandidate } from './match-content'

const MODEL = 'claude-haiku-4-5'

export interface EmailDraft {
  subject: string
  body: string
}

export interface CallNotes {
  /** Spoken phone opener — firewall applies (no tracking reveal). */
  spokenOpener: string
  /** Internal, agent-facing. EXPLICIT about the signal + matched content. */
  referenceContext: string
}

export interface OutreachDrafts {
  email: EmailDraft | null
  /** ≤160 chars, one link. Null when there's no linkable content. */
  sms: string | null
  callNotes: CallNotes
  /** The matched content (for the review UI: links, swap alternatives). */
  match: MatchResult
}

// ── Content + reference formatting (pure) ────────────────────────────

/** Human label for a content item, e.g. "12 Smith Street, Glebe — sold $1.2M". */
export function describeCandidate(c: ContentCandidate): string {
  const where = c.address ?? c.title ?? c.suburb ?? 'this property'
  if (c.content_type === 'sold') {
    const price = c.sold_price_text ? ` — sold ${c.sold_price_text}` : ' — recently sold'
    return `${where}${price}`
  }
  if (c.content_type === 'suburb_report') {
    return c.title ?? `${c.suburb} market report`
  }
  const price = c.price_text ? ` — ${c.price_text}` : ''
  return `${where}${price}`
}

const RULE_WHY: Record<MatchResult['rule'], string> = {
  repeat_listing: 'returned to one listing more than once',
  appraisal: 'visited the appraisal page',
  viewed_sold: 'has been looking at sold results',
  report_download: 'downloaded a suburb report',
  mixed: 'has been active across the area',
  none: 'is a known contact',
}

/** The internal call-notes block — explicit about the signal + the content to
 *  reference. Agent-only; never shown to the lead. */
export function buildReferenceContext(match: MatchResult, contactName: string): string {
  const lines: string[] = []
  lines.push(`Signal: ${contactName} ${RULE_WHY[match.rule]}${match.suburb ? ` in ${match.suburb}` : ''}.`)
  if (match.slots.length > 0) {
    lines.push('Reference these — your own content:')
    for (const slot of match.slots) {
      lines.push(`  • ${describeCandidate(slot.chosen)} — ${slot.chosen.source_url}`)
    }
  } else {
    lines.push('No fresh matching content — lead with the pretext only.')
  }
  lines.push('Reminder: on the call, never mention the website activity — it stays your insight.')
  return lines.join('\n')
}

/** Substitute the {{link}} token in a generated SMS with the real URL. Returns
 *  null when the model didn't leave a token but we have no other shape. */
export function substituteSmsLink(template: string, url: string | null): string | null {
  if (!url) return null
  if (template.includes('{{link}}')) return template.replace('{{link}}', url).trim()
  // Model omitted the token — append the link.
  return `${template.trim()} ${url}`.trim()
}

// ── Generation ───────────────────────────────────────────────────────

// Persona leaks: copy that breaks the "the agent wrote this themselves"
// illusion (revealing Horace/AI or "on behalf of" framing).
const PERSONA_LEAK_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\bhorace\b/i, label: 'Horace' },
  { re: /\bon\s+behalf\s+of\b/i, label: 'on behalf of' },
  { re: /\bwriting\s+for\s+(?:your|the)\s+agent\b/i, label: 'writing for your agent' },
  { re: /\b(?:as|i'?m|i\s+am)\s+an?\s+(?:ai|assistant|bot)\b/i, label: 'AI/assistant' },
  { re: /\bon\s+your\s+agent'?s?\s+behalf\b/i, label: "on your agent's behalf" },
]

export function findPersonaLeak(text: string): string | null {
  for (const { re, label } of PERSONA_LEAK_PATTERNS) if (re.test(text)) return label
  return null
}

const SYSTEM_PROMPT = `You ghost-write outbound messages that a real-estate agent sends to their own contacts. Write in the FIRST PERSON AS THE AGENT — as if the agent personally typed it. Voice: warm, brief, understated, never salesy. No emoji. No exclamation marks.

PERSONA — absolute:
- You ARE the agent. The recipient must believe the agent wrote this themselves.
- NEVER mention Horace, an AI, an assistant, automation, or that the message is written "on behalf of" / "for" the agent. No third-party framing of any kind.
- Sign only as the agent. Never sign or self-describe as anyone else.

THE FIREWALL — hard rule, applies to email, SMS, and the spoken call opener:
- What the contact did on the agent's website is PRIVATE to the agent. Your copy must NEVER reveal or imply it. The contact must not be able to tell they were ever tracked.
- Lean ONLY on the public/relationship hook in the PRETEXT block as your reason for reaching out. The CONTENT block is what you may naturally share — frame it as the agent thinking of them, not as a response to their behaviour.
- BANNED phrases — never write any of these in any wording: "I saw", "I noticed", "you viewed", "you've been looking", "your recent visits", "browsing", "on our site", "your activity", "while you were on the website".

OUTPUT — respond with ONLY a JSON object, no markdown:
{"subject": "...", "body": "...", "sms": "...", "call_opener": "..."}
- subject: ≤60 chars, specific to the pretext/content (not "Following up").
- body: ≤90 words, at most two short paragraphs. If a CONTENT item is given, reference one naturally and include its URL inline. End with the agent's first name on its own line (unless told a signature is appended).
- sms: ≤160 chars. If a CONTENT item is given, include the literal token {{link}} where its link should go (do NOT write a URL yourself). One sentence, warm.
- call_opener: one spoken sentence the agent can open a phone call with — natural, no tracking reveal.`

function buildUserBlock(
  contactName: string,
  contactFirst: string,
  agentFirst: string,
  pretext: SignalPretext,
  slots: MatchSlot[],
  voice: AgentVoice | undefined,
  retryNudge: string | null,
): string {
  const hasSig = !!voice?.email_signature
  const content =
    slots.length > 0
      ? ['CONTENT — your own, safe to share (pick the most relevant ONE):', ...slots.map((s) => `- ${describeCandidate(s.chosen)} (${s.chosen.source_url})`)].join('\n')
      : 'CONTENT: none available — write a brief pretext-only check-in; set sms to "" .'
  return [
    voice?.brand_voice ? `VOICE — write in this voice exactly (firewall + limits still apply):\n${voice.brand_voice}\n` : '',
    `CONTACT:\n- name: ${contactName}\n- first name: ${contactFirst || '(generic opener)'}`,
    hasSig ? 'SIGN-OFF: do NOT write a sign-off; a signature is appended.' : `SIGN-OFF: end the email body with "${agentFirst}".`,
    `PRETEXT — your ONLY reason for reaching out:\n- ${pretext.label}${pretext.detail ? `\n- detail you may use: ${pretext.detail}` : ''}`,
    content,
    'Write all four now. JSON only.',
    retryNudge ?? '',
  ].filter((l) => l !== '').join('\n\n')
}

interface RawGen {
  subject: string
  body: string
  sms: string
  call_opener: string
}

async function generate(
  client: Anthropic,
  contactName: string,
  contactFirst: string,
  agentFirst: string,
  pretext: SignalPretext,
  slots: MatchSlot[],
  voice: AgentVoice | undefined,
): Promise<RawGen | null> {
  let nudge: string | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 640,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: buildUserBlock(contactName, contactFirst, agentFirst, pretext, slots, voice, nudge) }],
      })
      const raw = message.content[0]?.type === 'text' ? message.content[0].text : ''
      const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      const p = JSON.parse(stripped) as Partial<RawGen>
      const subject = (p.subject ?? '').trim()
      const body = (p.body ?? '').trim()
      const sms = (p.sms ?? '').trim()
      const call_opener = (p.call_opener ?? '').trim()
      if (!subject || !body || !call_opener) {
        nudge = '\nYour previous reply was incomplete. Return JSON with subject, body, sms, call_opener all populated.'
        continue
      }
      // Firewall every lead-facing field (subject, body, sms, spoken opener).
      const violation =
        findBannedPhrase(subject) ?? findBannedPhrase(body) ?? findBannedPhrase(sms) ?? findBannedPhrase(call_opener)
      if (violation) {
        nudge = `\nYour previous draft used "${violation}", which violates the firewall. Rewrite every field without that phrasing — never imply the contact was tracked.`
        continue
      }
      // Persona leak: the message must read as the agent's own, never reveal
      // Horace/AI or "on behalf of" framing.
      const leak = findPersonaLeak(subject) ?? findPersonaLeak(body) ?? findPersonaLeak(sms) ?? findPersonaLeak(call_opener)
      if (leak) {
        nudge = `\nYour previous draft said "${leak}" — that breaks character. You ARE the agent writing personally. Rewrite with no mention of Horace, AI, or writing "on behalf of" anyone.`
        continue
      }
      return { subject, body, sms, call_opener }
    } catch (err) {
      console.error('[ai:draft-outreach] generation failed:', err)
      return null
    }
  }
  console.warn('[ai:draft-outreach] firewall held — no draft after retry.')
  return null
}

export interface DraftOutreachArgs {
  agentName: string
  contact: { name: string; first_name: string | null }
  pretext: SignalPretext
  match: MatchResult
  voice?: AgentVoice
}

/** Assemble the three drafts. Pure given a generator result — the IO wrapper
 *  below handles the Anthropic client + caching. */
export function assembleDrafts(gen: RawGen | null, args: DraftOutreachArgs): OutreachDrafts {
  const referenceContext = buildReferenceContext(args.match, args.contact.name)
  const primaryUrl = args.match.slots[0]?.chosen.source_url ?? null

  if (!gen) {
    // Firewall held / model unavailable: no lead-facing copy, but the agent
    // still gets the internal call context (the signal is theirs to act on).
    return {
      email: null,
      sms: null,
      callNotes: { spokenOpener: '', referenceContext },
      match: args.match,
    }
  }

  let body = gen.body
  if (args.voice?.email_signature) body = `${body}\n\n${args.voice.email_signature}`

  return {
    email: { subject: gen.subject, body },
    sms: substituteSmsLink(gen.sms, primaryUrl),
    callNotes: { spokenOpener: gen.call_opener, referenceContext },
    match: args.match,
  }
}

/** Cache-wrapped end to end. Keyed on contact + the chosen content ids + voice
 *  so a swap or profile edit busts stale drafts; pre-generated on nudge-create
 *  so the nudge opens with drafts ready (AC: <2s). Returns internal-only call
 *  notes even when the API key is unset. */
export async function getOutreachDrafts(args: DraftOutreachArgs & { agentId: string; contactId: string }): Promise<OutreachDrafts> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return assembleDrafts(null, args)

  const contentKey = args.match.slots.map((s) => s.chosen.id).join(',') || 'nocontent'
  const voiceKey = args.voice ? `${(args.voice.brand_voice ?? '').length}:${(args.voice.email_signature ?? '').length}` : 'novoice'

  const cached = unstable_cache(
    async () => {
      const client = new Anthropic({ apiKey })
      const first = args.contact.first_name?.trim() || args.contact.name.split(' ')[0] || ''
      const agentFirst = args.agentName.split(' ')[0] || args.agentName
      return generate(client, args.contact.name, first, agentFirst, args.pretext, args.match.slots, args.voice)
    },
    ['outreach-drafts-v2', args.contactId, args.match.rule, contentKey, voiceKey],
    { tags: [`outreach:${args.agentId}`], revalidate: 86400 },
  )
  return assembleDrafts(await cached(), args)
}
