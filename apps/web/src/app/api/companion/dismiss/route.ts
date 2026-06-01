import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

// POST /api/companion/dismiss
//
// Records a per-agent dismissal in `dismissed_signals` (HOR-243). Callers
// pass an opaque `scope` key (e.g. `digest:contact:<id>`, `property-
// suggestion:<id>`); future surfaces extend the convention without
// touching this endpoint.
//
// 200 — dismissal recorded (or already present — the unique constraint
//       absorbs duplicate clicks silently).
// 401 — no session.
// 422 — bad body.
// 503 — `dismissed_signals` table missing (pre-migration). Surface
//       cleanly so the companion's moss pill can still show "noted" copy.

interface Body {
  scope: string
  reason?: string | null
  /** Optional ISO timestamp. Null = forever. */
  expiresAt?: string | null
}

export async function POST(request: Request) {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 422 })
  }

  const scope = typeof body.scope === 'string' ? body.scope.trim() : ''
  if (!scope) {
    return NextResponse.json({ error: 'scope_required' }, { status: 422 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const agent = await resolvePrimaryAgent(supabase, user.id)
  if (!agent?.workspace_id) {
    return NextResponse.json({ error: 'no_workspace' }, { status: 401 })
  }

  // `dismissed_signals` is introduced in migration 20260520000001; the
  // generated supabase Database type doesn't know about it until the
  // schema regenerates. Cast follows the same pattern used for
  // `email_sends` while HOR-223 was pre-regen.
  const admin = createAdminClient()
  const { error } = await admin
    .from('dismissed_signals' as never)
    .upsert(
      {
        workspace_id: agent.workspace_id,
        agent_id: agent.id,
        scope,
        reason: body.reason ?? null,
        expires_at: body.expiresAt ?? null,
      } as never,
      { onConflict: 'agent_id,scope' },
    )

  if (error) {
    // Missing-table case (pre-migration). 42P01 = undefined_table in Postgres.
    if (error.code === '42P01') {
      console.warn('[companion/dismiss] dismissed_signals table missing — apply 20260520000001')
      return NextResponse.json(
        { error: 'table_missing', message: 'dismissed_signals migration not applied' },
        { status: 503 },
      )
    }
    console.error('[companion/dismiss] upsert failed:', error)
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, scope }, { status: 200 })
}
