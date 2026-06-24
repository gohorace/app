import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({
  sensitivity: z.enum(['low', 'medium', 'high']),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const admin = createAdminClient()
  const agent = await resolvePrimaryAgent(admin, user.id, { requireWorkspace: true })
  if (!agent?.workspace_id) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  }

  const { error } = await admin
    .from('workspaces')
    .update({ sensitivity: parsed.data.sensitivity })
    .eq('id', agent.workspace_id)

  if (error) {
    console.error('[sensitivity] update error:', error)
    return NextResponse.json({ error: error.message ?? 'Failed to save' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
