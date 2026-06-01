import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

const schema = z.object({
  destination_url: z.string().trim().max(500).nullable(),
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
    throw new Error('Enter a valid URL (e.g. https://yourdomain.com/page)')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL must use http or https')
  }
  return url.toString()
}

// PATCH /api/contacts/{id}/tracked-link
// Updates the per-link destination override. Pass `destination_url: null` to
// clear the override and fall back to agent_settings.website_url.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  let normalised: string | null
  try {
    normalised = normaliseUrl(parsed.data.destination_url)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }

  const admin = createAdminClient()
  const agent = await resolvePrimaryAgent(admin, user.id)

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const { error } = await admin
    .from('contact_tracked_links')
    .update({ destination_url: normalised })
    .eq('contact_id', params.id)
    .eq('agent_id', agent.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, destination_url: normalised })
}
