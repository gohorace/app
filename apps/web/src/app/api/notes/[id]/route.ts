import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * PATCH /api/notes/[id] — edit body or toggle resolved (HOR-252).
 * Author-only for body edits (enforced by checking author_id); resolve
 * is allowed for any workspace member in v2.0 (a teammate can mark a
 * loop closed). RLS already scopes writes to the author for body, so
 * resolve-by-others routes through the admin client with an explicit
 * workspace check.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  let body: { body?: string; resolved?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 422 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!agent?.workspace_id) return NextResponse.json({ error: 'no_workspace' }, { status: 401 })

  // Fetch the note (workspace-scoped) to authorise.
  const { data: noteRow, error: readErr } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('notes' as any)
    .select('id, author_id, workspace_id')
    .eq('id', params.id)
    .maybeSingle()
  if (readErr?.code === '42P01') {
    return NextResponse.json({ error: 'table_missing' }, { status: 503 })
  }
  const note = noteRow as { id: string; author_id: string; workspace_id: string } | null
  if (!note || note.workspace_id !== agent.workspace_id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const patch: Record<string, unknown> = {}
  if (typeof body.body === 'string') {
    if (note.author_id !== agent.id) {
      return NextResponse.json({ error: 'not_author' }, { status: 403 })
    }
    const trimmed = body.body.trim()
    if (!trimmed) return NextResponse.json({ error: 'body_required' }, { status: 422 })
    patch.body = trimmed
    patch.edited_at = new Date().toISOString()
  }
  if (typeof body.resolved === 'boolean') {
    patch.resolved = body.resolved
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing_to_update' }, { status: 422 })
  }

  const { error } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('notes' as any)
    .update(patch as never)
    .eq('id', params.id)
  if (error) {
    console.error('[notes] PATCH failed:', error)
    return NextResponse.json({ error: 'update_failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true }, { status: 200 })
}
