import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

// POST/DELETE /api/stream/clear
//
// Per-card Clear on the Today's-activity Stream. Persists into the
// existing `dismissed_signals` table with a Stream-specific scope so the
// digest page filter is unambiguous and we never tangle with the
// companion's `digest:contact:` dismissals.
//
// Stub note: `expires_at` is hard-coded to NULL — "suppress indefinitely
// until manually un-cleared." The deviation engine that would re-surface
// a cleared entity on a new pattern-break does not exist yet; until it
// does, the only path back to the Stream is DELETE (the Undo toast).
// Do NOT swap NULL for a timer — that rebuilds snooze, which is the
// exact thing this feature is avoiding.

const SCOPE_PREFIX = 'stream:clear:contact:'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Body {
  contactId: string
}

async function resolveActor() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthenticated' as const, status: 401 as const }

  const agent = await resolvePrimaryAgent(supabase, user.id)
  if (!agent?.workspace_id) return { error: 'no_workspace' as const, status: 401 as const }

  return { agent }
}

async function readBody(request: Request): Promise<{ contactId: string } | { error: string; status: number }> {
  let raw: Body
  try {
    raw = (await request.json()) as Body
  } catch {
    return { error: 'invalid_json', status: 422 }
  }
  const contactId = typeof raw.contactId === 'string' ? raw.contactId.trim() : ''
  if (!contactId || !UUID_RE.test(contactId)) {
    return { error: 'contact_id_required', status: 422 }
  }
  return { contactId }
}

export async function POST(request: Request) {
  const body = await readBody(request)
  if ('error' in body) return NextResponse.json({ error: body.error }, { status: body.status })

  const actor = await resolveActor()
  if ('error' in actor) return NextResponse.json({ error: actor.error }, { status: actor.status })

  const scope = `${SCOPE_PREFIX}${body.contactId}`
  const admin = createAdminClient()
  const { error } = await admin
    .from('dismissed_signals' as never)
    .upsert(
      {
        workspace_id: actor.agent.workspace_id,
        agent_id: actor.agent.id,
        scope,
        reason: 'stream_clear',
        expires_at: null,
      } as never,
      { onConflict: 'agent_id,scope' },
    )

  if (error) {
    if (error.code === '42P01') {
      return NextResponse.json({ error: 'table_missing' }, { status: 503 })
    }
    console.error('[stream/clear] upsert failed:', error)
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, scope }, { status: 200 })
}

export async function DELETE(request: Request) {
  const body = await readBody(request)
  if ('error' in body) return NextResponse.json({ error: body.error }, { status: body.status })

  const actor = await resolveActor()
  if ('error' in actor) return NextResponse.json({ error: actor.error }, { status: actor.status })

  const scope = `${SCOPE_PREFIX}${body.contactId}`
  const admin = createAdminClient()
  const { error } = await admin
    .from('dismissed_signals' as never)
    .delete()
    .eq('agent_id', actor.agent.id)
    .eq('scope', scope)

  if (error) {
    console.error('[stream/clear] delete failed:', error)
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, scope }, { status: 200 })
}
