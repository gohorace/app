import { createAdminClient } from '@/lib/supabase/admin'
import type { McpAuthContext } from '@/lib/mcp/auth'
import { loadOwnedContacts } from '@/lib/mcp/outreach-helpers'
import { unsubscribeUrl } from '@/lib/outreach/unsubscribe'
import { generateShortCode } from '@/lib/outreach/links'
import { getAppUrl } from '@/lib/url'
import { loadProfile, PROFILE_QUESTIONS, type AgentProfile } from '@/lib/mcp/profile'
import { sendTrackedEmail, SendTrackedEmailError } from '@/lib/email/send'
import type { EmailSendPayload } from '@/lib/email/types'

export interface McpTool {
  name: string
  description: string
  inputSchema: object
  handler: (args: unknown, ctx: McpAuthContext) => Promise<unknown>
}

const listContacts: McpTool = {
  name: 'list_contacts',
  description:
    'List contacts owned by the connected agent. Returns id, name, email, ' +
    'sensitivity (the contact\'s behaviour-signal level), last seen and CRM ' +
    'source. Use to find candidates for outreach. ' +
    'DEPRECATED ALIASES (still accepted, slated for removal in v0.3): ' +
    'params min_score / max_score and sort:"score" map to min_sensitivity / ' +
    'max_sensitivity and sort:"sensitivity". Each returned contact also ' +
    'includes a `score` field that mirrors `sensitivity` for back-compat.',
  inputSchema: {
    type: 'object',
    properties: {
      min_sensitivity: { type: 'number', description: 'Minimum behaviour-signal sensitivity' },
      max_sensitivity: { type: 'number', description: 'Maximum behaviour-signal sensitivity' },
      min_score: {
        type: 'number',
        description: 'DEPRECATED — use min_sensitivity. Kept for back-compat until v0.3.',
      },
      max_score: {
        type: 'number',
        description: 'DEPRECATED — use max_sensitivity. Kept for back-compat until v0.3.',
      },
      has_email: { type: 'boolean', description: 'Only contacts with an email address' },
      include_unsubscribed: {
        type: 'boolean',
        description: 'Include contacts who have unsubscribed (default false)',
      },
      last_seen_within_days: {
        type: 'number',
        description: 'Only contacts seen on the website within the last N days',
      },
      sort: {
        type: 'string',
        enum: ['sensitivity', 'score', 'last_seen', 'created_at'],
        description:
          'Sort order, descending. Defaults to sensitivity. "score" is a ' +
          'deprecated alias for "sensitivity" (kept for back-compat until v0.3).',
      },
      limit: { type: 'number', description: 'Max rows (default 25, cap 200)' },
      offset: { type: 'number', description: 'Pagination offset' },
    },
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const a = (args ?? {}) as {
      min_sensitivity?: number
      max_sensitivity?: number
      min_score?: number
      max_score?: number
      has_email?: boolean
      include_unsubscribed?: boolean
      last_seen_within_days?: number
      sort?: 'sensitivity' | 'score' | 'last_seen' | 'created_at'
      limit?: number
      offset?: number
    }
    const limit = Math.min(Math.max(a.limit ?? 25, 1), 200)
    const offset = Math.max(a.offset ?? 0, 0)
    const minSensitivity = a.min_sensitivity ?? a.min_score
    const maxSensitivity = a.max_sensitivity ?? a.max_score
    const sortColumn =
      a.sort === 'last_seen' ? 'last_seen_at' : a.sort === 'created_at' ? 'created_at' : 'score'

    const admin = createAdminClient()
    let q = admin
      .from('contacts')
      .select('id, first_name, last_name, email, phone, score, last_seen_at, identified_at, unsubscribed_at, source, medium, created_at')
      .eq('agent_id', ctx.agentId)
      .order(sortColumn, { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    if (typeof minSensitivity === 'number') q = q.gte('score', minSensitivity)
    if (typeof maxSensitivity === 'number') q = q.lte('score', maxSensitivity)
    if (a.has_email === true) q = q.not('email', 'is', null)
    if (a.has_email === false) q = q.is('email', null)
    if (!a.include_unsubscribed) q = q.is('unsubscribed_at', null)
    if (typeof a.last_seen_within_days === 'number' && a.last_seen_within_days > 0) {
      const cutoff = new Date(Date.now() - a.last_seen_within_days * 86_400_000).toISOString()
      q = q.gte('last_seen_at', cutoff)
    }

    const { data, error } = await q
    if (error) throw new Error(error.message)
    const contacts = (data ?? []).map((c) => ({ ...c, sensitivity: c.score }))
    return { contacts, limit, offset }
  },
}

const getContact: McpTool = {
  name: 'get_contact',
  description:
    'Get a single contact by id, including the most recent behaviour-signal ' +
    'history entries (sensitivity deltas with reasons). Use when you need full ' +
    'detail before drafting outreach. ' +
    'DEPRECATED ALIAS (slated for removal in v0.3): the response also includes ' +
    '`score_history` (mirror of `behaviour_signal_history`), and each history ' +
    'row includes `score_before` / `score_after` (mirrors of `sensitivity_before` ' +
    '/ `sensitivity_after`).',
  inputSchema: {
    type: 'object',
    properties: { contact_id: { type: 'string', description: 'Contact UUID' } },
    required: ['contact_id'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const { contact_id } = args as { contact_id: string }
    const admin = createAdminClient()

    const [{ data: contact, error: cErr }, { data: history }] = await Promise.all([
      admin
        .from('contacts')
        .select('*')
        .eq('id', contact_id)
        .eq('agent_id', ctx.agentId)
        .maybeSingle(),
      admin
        .from('score_history')
        .select('delta, reason, score_before, score_after, occurred_at')
        .eq('contact_id', contact_id)
        .eq('agent_id', ctx.agentId)
        .order('occurred_at', { ascending: false })
        .limit(10),
    ])

    if (cErr) throw new Error(cErr.message)
    if (!contact) throw new Error('Contact not found')
    const behaviourSignalHistory = (history ?? []).map((h) => ({
      delta: h.delta,
      reason: h.reason,
      sensitivity_before: h.score_before,
      sensitivity_after: h.score_after,
      score_before: h.score_before,
      score_after: h.score_after,
      occurred_at: h.occurred_at,
    }))
    const contactWithSensitivity =
      contact && typeof contact === 'object' && 'score' in contact
        ? { ...contact, sensitivity: (contact as { score: number | null }).score }
        : contact
    return {
      contact: contactWithSensitivity,
      behaviour_signal_history: behaviourSignalHistory,
      score_history: behaviourSignalHistory,
    }
  },
}

const getLeadActivity: McpTool = {
  name: 'get_lead_activity',
  description:
    'Get recent website activity (page/property views, form submits, scroll depth, ' +
    'campaign clicks, return visits) for a contact. Use to ground outreach in what ' +
    'the contact actually looked at.',
  inputSchema: {
    type: 'object',
    properties: {
      contact_id: { type: 'string', description: 'Contact UUID' },
      limit: { type: 'number', description: 'Max events (default 25, cap 100)' },
    },
    required: ['contact_id'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const a = args as { contact_id: string; limit?: number }
    const limit = Math.min(Math.max(a.limit ?? 25, 1), 100)
    const admin = createAdminClient()

    const { data: contact } = await admin
      .from('contacts')
      .select('id')
      .eq('id', a.contact_id)
      .eq('agent_id', ctx.agentId)
      .maybeSingle()
    if (!contact) throw new Error('Contact not found')

    const { data, error } = await admin.rpc('get_contact_events', { p_contact_id: a.contact_id })
    if (error) throw new Error(error.message)
    return { events: (data ?? []).slice(0, limit) }
  },
}

const getWeeklyBrief: McpTool = {
  name: 'get_weekly_brief',
  description:
    'Get the same top-leads briefing data the weekly email uses: top 10 contacts ' +
    'by sensitivity (behaviour-signal) change in the last 7 days. Use to anchor ' +
    'a weekly outreach session.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async handler(_args, ctx) {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('get_weekly_briefing_data', {
      p_agent_id: ctx.agentId,
    })
    if (error) throw new Error(error.message)
    return { leads: data ?? [] }
  },
}

const searchContacts: McpTool = {
  name: 'search_contacts',
  description:
    'Find contacts by free-text match against name or email. Use when the user ' +
    'refers to someone by name or partial email rather than browsing a list.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, description: 'Search string (case-insensitive)' },
      limit: { type: 'number', description: 'Max rows (default 10, cap 50)' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const a = args as { query: string; limit?: number }
    const q = a.query.trim()
    if (!q) return { contacts: [] }
    const limit = Math.min(Math.max(a.limit ?? 10, 1), 50)
    const escaped = q.replace(/[%,\\]/g, (c) => '\\' + c)
    const pattern = `%${escaped}%`

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('contacts')
      .select('id, first_name, last_name, email, score, last_seen_at')
      .eq('agent_id', ctx.agentId)
      .or(`email.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern}`)
      .order('score', { ascending: false })
      .limit(limit)

    if (error) throw new Error(error.message)
    const contacts = (data ?? []).map((c) => ({ ...c, sensitivity: c.score }))
    return { contacts }
  },
}

// ============================================================
// WRITE / OUTREACH TOOLS
// ============================================================

const shortenLink: McpTool = {
  name: 'shorten_link',
  description:
    'Create a Horace-hosted short URL (https://<app>/r/<code>) that 302s ' +
    'to the target. Use in SMS where character count matters.',
  inputSchema: {
    type: 'object',
    properties: {
      target_url: { type: 'string', minLength: 8 },
      contact_id: { type: 'string', description: 'Optional contact to attribute the click to' },
    },
    required: ['target_url'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const a = args as {
      target_url: string
      contact_id?: string
    }
    if (!/^https?:\/\//i.test(a.target_url)) {
      throw new Error('target_url must be an absolute http(s) URL')
    }
    const admin = createAdminClient()

    if (a.contact_id) {
      await loadOwnedContacts(admin, ctx.agentId, [a.contact_id])
    }

    // Insert with retry on rare collision (~1 in 218T at 8 chars)
    let row: { code: string } | null = null
    for (let attempt = 0; attempt < 4 && !row; attempt++) {
      const code = generateShortCode(8)
      const { data, error } = await admin
        .from('short_links')
        .insert({
          agent_id: ctx.agentId,
          contact_id: a.contact_id ?? null,
          code,
          target_url: a.target_url,
        })
        .select('code')
        .single()
      if (data) row = data
      else if (error && !error.message.includes('short_links_code_key')) throw new Error(error.message)
    }
    if (!row) throw new Error('Failed to allocate short code')

    const appUrl = getAppUrl()
    return {
      short_url: appUrl ? `${appUrl}/r/${row.code}` : `/r/${row.code}`,
      code: row.code,
      target_url: a.target_url,
      contact_id: a.contact_id ?? null,
    }
  },
}

const draftOutreach: McpTool = {
  name: 'draft_outreach',
  description:
    'Build the structured pieces of an outreach email for a single contact: ' +
    'recipient details, decorated links, unsubscribe URL, suggested subject, ' +
    'body skeleton, and the agent profile (brand voice, signature, website, ' +
    'positioning) you must write in. The caller (Claude) writes the prose and ' +
    "hands the final email to the user's connected email tool. " +
    'REQUIRES a complete agent_profile (brand_voice + email_signature). If ' +
    'incomplete, returns {setup_required: true} — call start_profile_interview, ' +
    'collect answers from the user, save_agent_profile, then retry. Also ' +
    'refuses if the contact has unsubscribed.',
  inputSchema: {
    type: 'object',
    properties: {
      contact_id: { type: 'string' },
      intent: {
        type: 'string',
        description:
          'Short label for the outreach purpose, e.g. "follow_up_after_open_house", ' +
          '"new_listing", "re_engage". Used to suggest a subject line.',
      },
      target_urls: {
        type: 'array',
        items: {
          oneOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: {
                url: { type: 'string' },
                label: { type: 'string' },
              },
              required: ['url'],
              additionalProperties: false,
            },
          ],
        },
        maxItems: 5,
      },
    },
    required: ['contact_id', 'intent'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const a = args as {
      contact_id: string
      intent: string
      target_urls?: Array<string | { url: string; label?: string }>
    }
    const admin = createAdminClient()

    // Gate: profile must be complete before drafting outreach.
    const profile = await loadProfile(admin, ctx.agentId)
    if (!profile.complete) {
      return {
        setup_required: true,
        missing: profile.missing_required,
        message:
          'Before I can draft outreach in your voice, I need a few setup details ' +
          `from you (${profile.missing_required.join(', ')}).`,
        next_action:
          'Call start_profile_interview to get the question script, ask the user one ' +
          'question at a time, then call save_agent_profile with their answers, then ' +
          'retry draft_outreach.',
      }
    }

    const [contact] = await loadOwnedContacts(admin, ctx.agentId, [a.contact_id])
    if (contact.unsubscribed_at) {
      throw new Error('Contact has unsubscribed and cannot be contacted')
    }

    const targets = (a.target_urls ?? []).map((t) =>
      typeof t === 'string' ? { url: t, label: undefined } : t,
    )

    const decoratedLinks = targets.map((t) => ({
      label: t.label ?? null,
      target_url: t.url,
    }))

    const appUrl = getAppUrl()
    const unsubUrl = appUrl ? unsubscribeUrl(appUrl, contact.id) : ''

    const fullName =
      [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email || 'there'

    // Last 5 events as a one-line summary for grounding the prose.
    const { data: events } = await admin.rpc('get_contact_events', {
      p_contact_id: contact.id,
    })
    const recent = (events ?? []).slice(0, 5).map((e) => {
      const props = (e.properties ?? {}) as Record<string, unknown>
      const url = typeof props.url === 'string' ? props.url : ''
      return { type: e.event_type, url, occurred_at: e.occurred_at }
    })

    const intentLabel = a.intent.replace(/_/g, ' ').trim()
    const suggestedSubject =
      contact.first_name
        ? `${capitalize(intentLabel)} — quick note for ${contact.first_name}`
        : capitalize(intentLabel)

    const footerMarkdown = unsubUrl
      ? `\n\n---\nIf you'd rather not receive these, you can [unsubscribe](${unsubUrl}).`
      : ''

    const linksBlock = decoratedLinks.length
      ? '\n\n' +
        decoratedLinks
          .map((l) => `- [${l.label ?? l.target_url}](${l.target_url})`)
          .join('\n')
      : ''

    const suggestedBodyMarkdown =
      `Hi ${contact.first_name ?? 'there'},\n\n` +
      `{{write 1–3 sentences here grounded in the recipient's recent activity}}` +
      linksBlock +
      footerMarkdown

    return {
      contact: {
        id: contact.id,
        email: contact.email,
        first_name: contact.first_name,
        last_name: contact.last_name,
        full_name: fullName,
      },
      decorated_links: decoratedLinks,
      unsubscribe_url: unsubUrl,
      suggested_subject: suggestedSubject,
      suggested_body_markdown: suggestedBodyMarkdown,
      footer_markdown: footerMarkdown,
      recent_activity: recent,
      intent: a.intent,
      agent_profile: {
        brand_voice: profile.brand_voice,
        email_signature: profile.email_signature,
        website_url: profile.website_url,
        market_positioning: profile.market_positioning,
      },
      drafting_guidance:
        'Write the email body in the brand_voice exactly. End with the ' +
        'email_signature verbatim (preserve newlines). Insert decorated_links ' +
        'naturally — do not paste the raw target_url. Reference market_positioning ' +
        'or website_url only if it fits the recipient\'s recent_activity. Keep the ' +
        'unsubscribe footer at the bottom.',
    }
  },
}

const recordSend: McpTool = {
  name: 'record_send',
  description:
    'Record that an outbound message was sent to a contact. Used after the ' +
    "user's email tool actually delivers, or after send_sms returns. Powers " +
    'dedup ("don\'t email people I emailed this week") and reporting.',
  inputSchema: {
    type: 'object',
    properties: {
      contact_id: { type: 'string' },
      channel: { type: 'string', enum: ['email', 'sms'] },
      subject: { type: 'string', maxLength: 200 },
      message_preview: { type: 'string', maxLength: 500, description: 'First ~500 chars of body' },
      external_id: { type: 'string', description: 'Provider message id (Gmail thread, Twilio SID, etc.)' },
    },
    required: ['contact_id', 'channel'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const a = args as {
      contact_id: string
      channel: 'email' | 'sms'
      subject?: string
      message_preview?: string
      external_id?: string
    }
    const admin = createAdminClient()
    await loadOwnedContacts(admin, ctx.agentId, [a.contact_id])

    const { data, error } = await admin
      .from('outreach_log')
      .insert({
        agent_id: ctx.agentId,
        contact_id: a.contact_id,
        channel: a.channel,
        subject: a.subject ?? null,
        message_preview: a.message_preview ?? null,
        external_id: a.external_id ?? null,
        source: 'mcp',
      })
      .select('id, sent_at')
      .single()
    if (error || !data) throw new Error(error?.message ?? 'Failed to record send')
    return { logged: true, id: data.id, sent_at: data.sent_at }
  },
}

const sendSms: McpTool = {
  name: 'send_sms',
  description:
    'Send an SMS to a contact server-side via Twilio. Refuses if the contact ' +
    'has no phone number or has unsubscribed. Records the send in the outreach ' +
    'log. Returns the Twilio message SID (or a stub id when Twilio is not ' +
    'configured in the environment).',
  inputSchema: {
    type: 'object',
    properties: {
      contact_id: { type: 'string' },
      body: { type: 'string', minLength: 1, maxLength: 1600 },
      campaign_id: { type: 'string' },
    },
    required: ['contact_id', 'body'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const a = args as { contact_id: string; body: string; campaign_id?: string }
    const admin = createAdminClient()
    const [contact] = await loadOwnedContacts(admin, ctx.agentId, [a.contact_id])
    if (contact.unsubscribed_at) throw new Error('Contact has unsubscribed')
    if (!contact.phone) throw new Error('Contact has no phone number')

    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    const from = process.env.TWILIO_FROM_NUMBER

    let externalId = `stub_${Date.now()}`
    let stubbed = true
    if (accountSid && authToken && from && !accountSid.startsWith('ACxxx')) {
      const { default: Twilio } = await import('twilio')
      const client = Twilio(accountSid, authToken)
      const msg = await client.messages.create({ from, to: contact.phone, body: a.body })
      externalId = msg.sid
      stubbed = false
    }

    await admin.from('outreach_log').insert({
      agent_id: ctx.agentId,
      contact_id: a.contact_id,
      campaign_id: a.campaign_id ?? null,
      channel: 'sms',
      message_preview: a.body.slice(0, 500),
      external_id: externalId,
      source: 'mcp',
    })

    return { sent: !stubbed, stubbed, external_id: externalId }
  },
}

const logNote: McpTool = {
  name: 'log_note',
  description:
    'Attach a free-form note to a contact (e.g. call summary, meeting notes, ' +
    'reply received). Visible in the dashboard activity timeline.',
  inputSchema: {
    type: 'object',
    properties: {
      contact_id: { type: 'string' },
      body: { type: 'string', minLength: 1, maxLength: 4000 },
    },
    required: ['contact_id', 'body'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const a = args as { contact_id: string; body: string }
    const admin = createAdminClient()
    await loadOwnedContacts(admin, ctx.agentId, [a.contact_id])
    const { data, error } = await admin
      .from('contact_notes')
      .insert({
        agent_id: ctx.agentId,
        contact_id: a.contact_id,
        body: a.body,
        source: 'mcp',
      })
      .select('id, created_at')
      .single()
    if (error || !data) throw new Error(error?.message ?? 'Failed to log note')
    return { id: data.id, created_at: data.created_at }
  },
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s
}

// ============================================================
// AGENT PROFILE / ONBOARDING TOOLS
// ============================================================

const getAgentProfile: McpTool = {
  name: 'get_agent_profile',
  description:
    'Read the agent\'s outreach profile: brand voice, email signature, website ' +
    'URL, market positioning. Returns {complete} and {missing_required} so you ' +
    'can decide whether to start the profile interview before drafting outreach.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async handler(_args, ctx) {
    const admin = createAdminClient()
    return await loadProfile(admin, ctx.agentId)
  },
}

const saveAgentProfile: McpTool = {
  name: 'save_agent_profile',
  description:
    'Update one or more agent profile fields. Partial updates are fine — pass ' +
    'only the fields you have answers for. Validates website_url is an https URL. ' +
    'Use this after collecting answers via start_profile_interview, or whenever ' +
    'the user wants to change tone/signature/etc.',
  inputSchema: {
    type: 'object',
    properties: {
      brand_voice:        { type: 'string', maxLength: 1000 },
      email_signature:    { type: 'string', maxLength: 1000 },
      website_url:        { type: 'string', maxLength: 500 },
      market_positioning: { type: 'string', maxLength: 500 },
    },
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const a = (args ?? {}) as Partial<AgentProfile>
    const update: Partial<AgentProfile> = {}

    if (typeof a.brand_voice === 'string')        update.brand_voice = a.brand_voice.trim() || null
    if (typeof a.email_signature === 'string')    update.email_signature = a.email_signature.trim() || null
    if (typeof a.market_positioning === 'string') update.market_positioning = a.market_positioning.trim() || null

    if (typeof a.website_url === 'string') {
      let url = a.website_url.trim()
      if (url) {
        // Allow bare domains; coerce to https.
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url
        try {
          const parsed = new URL(url)
          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            throw new Error('website_url must be http or https')
          }
          update.website_url = parsed.toString()
        } catch {
          throw new Error('website_url is not a valid URL')
        }
      } else {
        update.website_url = null
      }
    }

    if (Object.keys(update).length === 0) {
      throw new Error('No fields supplied. Pass at least one of brand_voice, email_signature, website_url, market_positioning.')
    }

    const admin = createAdminClient()
    const { error } = await admin
      .from('agent_settings')
      .update(update)
      .eq('agent_id', ctx.agentId)
    if (error) throw new Error(error.message)

    return await loadProfile(admin, ctx.agentId)
  },
}

const startProfileInterview: McpTool = {
  name: 'start_profile_interview',
  description:
    'Get the script of questions to ask the user when setting up their outreach ' +
    'profile. Filters to only the missing fields by default. Ask one question at ' +
    'a time, show examples to unstick the user, then call save_agent_profile ' +
    'with the answers.',
  inputSchema: {
    type: 'object',
    properties: {
      include_filled: {
        type: 'boolean',
        description: 'Include questions for fields that already have a value (default false).',
      },
    },
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const a = (args ?? {}) as { include_filled?: boolean }
    const admin = createAdminClient()
    const profile = await loadProfile(admin, ctx.agentId)

    const questions = PROFILE_QUESTIONS.filter((q) =>
      a.include_filled ? true : !profile[q.field],
    )

    return {
      current: {
        brand_voice: profile.brand_voice,
        email_signature: profile.email_signature,
        website_url: profile.website_url,
        market_positioning: profile.market_positioning,
      },
      complete: profile.complete,
      missing_required: profile.missing_required,
      questions,
      instructions:
        'Ask each question in turn. Show 1–2 examples if the user seems stuck — ' +
        'do not invent answers for them. Keep your own commentary minimal; you\'re ' +
        'collecting their words, not editorialising. After collecting all required ' +
        'answers, call save_agent_profile with the values. Optional fields can be ' +
        'left out.',
      next_action:
        questions.length === 0
          ? 'Profile is already complete — no questions to ask.'
          : 'Ask the first question, await the user\'s reply, then proceed.',
    }
  },
}

// ── HOR-226 / slice D — send_tracked_email ───────────────────────────────
//
// Same orchestrator the UI route calls. Bearer-auth path → source='mcp'.
// MCP clients (Claude etc.) pass the same JSON the UI composer does.
const sendTrackedEmailTool: McpTool = {
  name: 'send_tracked_email',
  description:
    'Send a tracked email from the connected agent\'s Gmail account to one of their ' +
    'contacts. The send goes through Gmail (lands in the agent\'s Sent folder), with ' +
    'a 1×1 open-tracking pixel and link rewriting through r.gohorace.com. The ' +
    'recipient must NOT be on the agent\'s exclusion list and must not have ' +
    'unsubscribed. The agent must have a connected Gmail integration (see ' +
    '/settings/integrations). Use draft_outreach first to draft the body, then this ' +
    'tool to send it.',
  inputSchema: {
    type: 'object',
    properties: {
      contact_id: { type: 'string', description: 'UUID of the agent\'s contact to send to.' },
      to_email: {
        type: 'string',
        description: 'Optional override; defaults to the contact\'s email on file.',
      },
      subject: { type: 'string', description: 'Subject line (1–200 chars).' },
      body_html: {
        type: 'string',
        description: 'HTML body. Will be server-sanitized; <script>, <style>, on* attrs stripped.',
      },
      body_text: {
        type: 'string',
        description:
          'Optional plain-text alternative. Server derives one from body_html if absent.',
      },
      tracked: {
        type: 'boolean',
        description: 'Defaults to true. Set false to send without pixel + link rewriting.',
      },
    },
    required: ['contact_id', 'subject', 'body_html'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const a = (args ?? {}) as EmailSendPayload
    const admin = createAdminClient()
    try {
      return await sendTrackedEmail(
        {
          admin,
          agentId: ctx.agentId,
          workspaceId: ctx.workspaceId,
          source: 'mcp',
        },
        a,
      )
    } catch (err) {
      if (err instanceof SendTrackedEmailError) {
        // Surface the error code so the MCP client can branch on it
        // (e.g. show "Reconnect Gmail" for token_revoked).
        throw new Error(`${err.code}: ${err.message}`)
      }
      throw err
    }
  },
}

export const TOOLS: McpTool[] = [
  listContacts,
  getContact,
  getLeadActivity,
  getWeeklyBrief,
  searchContacts,
  shortenLink,
  draftOutreach,
  recordSend,
  sendSms,
  logNote,
  sendTrackedEmailTool,
  getAgentProfile,
  saveAgentProfile,
  startProfileInterview,
]

export const TOOL_BY_NAME: Record<string, McpTool> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t]),
)
