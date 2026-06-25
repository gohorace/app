import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

type AdminClient = SupabaseClient<Database>

export interface AgentProfile {
  brand_voice: string | null
  email_signature: string | null
  /** Rich-text signature HTML (HOR-xxx). Null for agents who haven't moved to
   *  the rich-text editor yet — `email_signature` (plain text) is the fallback. */
  email_signature_html: string | null
  /** Public logo URL composed into HTML signature at render time. */
  email_signature_logo_url: string | null
  website_url: string | null
  market_positioning: string | null
}

export interface ProfileStatus extends AgentProfile {
  complete: boolean
  missing_required: string[]
}

const REQUIRED_FIELDS = ['brand_voice', 'email_signature'] as const

export async function loadProfile(
  admin: AdminClient,
  agentId: string,
): Promise<ProfileStatus> {
  // email_signature_html + email_signature_logo_url aren't in database.types.ts
  // yet (regen deferred); read them via an `any` cast.
  const { data } = await admin
    .from('agent_settings')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select(
      'brand_voice, email_signature, email_signature_html, email_signature_logo_url, website_url, market_positioning' as any,
    )
    .eq('agent_id', agentId)
    .maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any

  const profile: AgentProfile = {
    brand_voice: nullIfEmpty(row?.brand_voice ?? null),
    email_signature: nullIfEmpty(row?.email_signature ?? null),
    email_signature_html: nullIfEmpty(row?.email_signature_html ?? null),
    email_signature_logo_url: nullIfEmpty(row?.email_signature_logo_url ?? null),
    website_url: nullIfEmpty(row?.website_url ?? null),
    market_positioning: nullIfEmpty(row?.market_positioning ?? null),
  }

  const missing_required = REQUIRED_FIELDS.filter((f) => !profile[f])
  return { ...profile, complete: missing_required.length === 0, missing_required }
}

function nullIfEmpty(s: string | null): string | null {
  if (!s) return null
  const t = s.trim()
  return t.length === 0 ? null : t
}

/**
 * The interview script used by start_profile_interview. Editing this is
 * how we tune onboarding without code changes elsewhere.
 */
export interface ProfileQuestion {
  field: keyof AgentProfile
  required: boolean
  ask: string
  examples: string[]
  guidance: string
}

export const PROFILE_QUESTIONS: ProfileQuestion[] = [
  {
    field: 'brand_voice',
    required: true,
    ask: 'How should I sound when writing on your behalf?',
    examples: [
      'Warm but professional, no hype, Australian English',
      'Polished, corporate, third-person company tone',
      'Casual and direct, first-name basis, mate-friendly',
    ],
    guidance:
      '1–2 sentences is enough. Capture: tone (warm/formal/casual), language ' +
      'preference (e.g. Australian English), and anything to avoid (e.g. no hype, ' +
      'no jargon). Don\'t lecture the user — collect what they say verbatim.',
  },
  {
    field: 'email_signature',
    required: true,
    ask: 'What signature should go at the bottom of every email?',
    examples: [
      'Matt Smith | Max Property | matt@maxproperty.au | 0400 000 000',
      "Cheers,\nMatt\nMax Property — Noosaville's local agent",
    ],
    guidance:
      'Capture exactly as they want it written. Multi-line is fine — preserve ' +
      'newlines. Don\'t embellish.',
  },
  {
    field: 'website_url',
    required: false,
    ask: 'What\'s your main website URL? (Optional — used for context links in emails.)',
    examples: ['https://maxproperty.au', 'https://www.smithrealestate.com.au'],
    guidance:
      'Validate it\'s an https URL. If they give a bare domain, prefix https://. ' +
      'Skip if they say they don\'t have one yet.',
  },
  {
    field: 'market_positioning',
    required: false,
    ask: 'In one sentence, who and where do you work with? (Optional — helps me ground outreach.)',
    examples: [
      'Noosaville and Sunshine Beach specialist, coastal lifestyle focus',
      'First-home buyers in Western Sydney',
      'Premium acreage in the Adelaide Hills',
    ],
    guidance:
      'Suburb / city + buyer or seller type + any niche. One sentence. Skip ' +
      'if they\'d rather not specialise.',
  },
]
