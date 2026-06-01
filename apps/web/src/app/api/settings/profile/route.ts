/**
 * PATCH /api/settings/profile — save the agent's brand voice + signature
 * (and optional website / positioning) to agent_settings.
 *
 * These power Horace's email drafting (lib/ai/signal-draft.ts) and gate the
 * composer dock's `setup` state. Until now they were only writable via the MCP
 * onboarding tool — this is the web UI's write path. (HOR-356 follow-up)
 *
 * Cookie-session auth (settings is a UI-only surface). Empty string clears a
 * field (→ null), which re-arms the dock's setup state.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'
import { z } from 'zod'

const schema = z
  .object({
    brand_voice: z.string().max(1000).optional(),
    email_signature: z.string().max(1000).optional(),
    website_url: z.string().max(500).optional(),
    market_positioning: z.string().max(1000).optional(),
  })
  .strict()

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  // Empty string clears the field (→ null); undefined leaves it untouched.
  const update: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(parsed.data)) {
    if (typeof v === 'string') update[k] = v.trim() || null
  }

  const admin = createAdminClient()
  const agentRow = await resolvePrimaryAgent(admin, user.id)
  if (!agentRow) return NextResponse.json({ error: 'No agent found' }, { status: 400 })

  const { error } = await admin
    .from('agent_settings')
    .upsert({ agent_id: agentRow.id, ...update }, { onConflict: 'agent_id' })

  if (error) {
    console.error('Profile settings patch error:', error)
    return NextResponse.json({ error: error.message ?? 'Failed to save' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
