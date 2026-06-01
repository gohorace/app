import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

// PATCH /api/settings/tracked-links
// Updates the agent's default destination URL for per-contact tracked links.
// Stored on agent_settings.website_url so the value is shared with the MCP
// outreach context (the AI uses it for copy generation too).

const schema = z.object({
  default_link_url: z.string().trim().max(500).nullable(),
})

function normaliseUrl(raw: string | null): string | null {
  if (raw === null) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  let candidate = trimmed
  if (!/^https?:\/\//i.test(candidate)) candidate = 'https://' + candidate
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new Error('Enter a valid URL (e.g. https://yourdomain.com)')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL must use http or https')
  }
  return url.toString()
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  let normalised: string | null
  try {
    normalised = normaliseUrl(parsed.data.default_link_url)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }

  const admin = createAdminClient()
  const agent = await resolvePrimaryAgent(admin, user.id)

  if (!agent) return NextResponse.json({ error: 'No agent found' }, { status: 400 })

  const { error } = await admin
    .from('agent_settings')
    .upsert(
      { agent_id: agent.id, website_url: normalised },
      { onConflict: 'agent_id' },
    )

  if (error) {
    console.error('Tracked-links settings error:', error)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, default_link_url: normalised })
}
