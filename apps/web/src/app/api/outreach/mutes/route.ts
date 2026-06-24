/**
 * GET/POST /api/outreach/mutes — HOR-389 (P5)
 *
 * Per-agent content-type mutes (agent_content_mutes, HOR-387). GET returns the
 * agent's muted types; POST toggles one. The matcher (matchContentForContact)
 * already excludes muted types, so a mute applies to all subsequent drafts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TYPES = new Set(['listing', 'sold', 'suburb_report'])

async function resolve(): Promise<{ agentId: string; workspaceId: string } | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const a = await resolvePrimaryAgent(admin, user.id, { requireWorkspace: true })
  if (!a || !a.workspace_id) return null
  return { agentId: a.id, workspaceId: a.workspace_id }
}

async function readMuted(agentId: string): Promise<string[]> {
  const admin = createAdminClient()
  const { data } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('agent_content_mutes' as any)
    .select('content_type')
    .eq('agent_id', agentId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => r.content_type as string)
}

export async function GET() {
  const ctx = await resolve()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ muted: await readMuted(ctx.agentId) })
}

export async function POST(req: NextRequest) {
  const ctx = await resolve()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { content_type?: string; muted?: boolean }
  try {
    body = (await req.json()) as { content_type?: string; muted?: boolean }
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 })
  }
  const type = body.content_type
  if (!type || !TYPES.has(type)) {
    return NextResponse.json({ error: 'content_type must be listing | sold | suburb_report' }, { status: 400 })
  }

  const admin = createAdminClient()
  if (body.muted) {
    await admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('agent_content_mutes' as any)
      .upsert({ workspace_id: ctx.workspaceId, agent_id: ctx.agentId, content_type: type }, { onConflict: 'workspace_id,agent_id,content_type' })
  } else {
    await admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('agent_content_mutes' as any)
      .delete()
      .eq('agent_id', ctx.agentId)
      .eq('content_type', type)
  }
  return NextResponse.json({ muted: await readMuted(ctx.agentId) })
}
