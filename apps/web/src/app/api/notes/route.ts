import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Note, NoteTeammate } from '@/lib/notes/types'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

/**
 * /api/notes — HOR-252 NotesThread backend.
 *
 *   GET  ?contactId=<id> | ?propertyId=<id>
 *        → { notes, teammates, currentAgentId }
 *   POST { contactId?|propertyId?, body, mentions: string[] }
 *        → { note }  (and fans out a notification_log row per mention)
 *
 * `notes` isn't in the generated Database type until regen, so reads/
 * writes use the `as never` cast (same pattern as email_sends / market).
 * Returns 503 when the table is missing (pre-migration) so the thread can
 * show an empty state instead of crashing.
 */

interface NoteRow {
  id: string
  author_id: string
  body: string
  mentions: string[] | null
  created_at: string
  edited_at: string | null
  resolved: boolean
}
interface AgentRow {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  role: string | null
}

/**
 * Resolve a display name + initials for an agent. Name-less agent rows
 * (e.g. accounts created before the split-name onboarding, where the name
 * lives in auth user_metadata, not on the agents row) fall back to the
 * email local-part rather than the anonymous "A teammate".
 */
function nameOf(a: AgentRow | undefined): { name: string; initials: string } {
  if (!a) return { name: 'A teammate', initials: '?' }
  const structured = [a.first_name, a.last_name].filter(Boolean).join(' ').trim()
  const emailLocal = a.email?.split('@')[0]?.trim() ?? ''
  const name = structured || emailLocal || 'A teammate'
  const structuredInitials = ((a.first_name?.[0] ?? '') + (a.last_name?.[0] ?? '')).toUpperCase()
  const initials = structuredInitials || emailLocal.slice(0, 2).toUpperCase() || '?'
  return { name, initials }
}

async function resolveAgent(userId: string) {
  const admin = createAdminClient()
  const agent = await resolvePrimaryAgent(admin, userId)
  return { admin, agent }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const contactId = url.searchParams.get('contactId')
  const propertyId = url.searchParams.get('propertyId')
  if (!contactId && !propertyId) {
    return NextResponse.json({ error: 'contactId_or_propertyId_required' }, { status: 422 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { admin, agent } = await resolveAgent(user.id)
  if (!agent?.workspace_id) return NextResponse.json({ error: 'no_workspace' }, { status: 401 })

  // Workspace teammates — for the @mention picker + author rendering.
  const { data: agentRows } = await admin
    .from('agents')
    .select('id, first_name, last_name, email, role')
    .eq('workspace_id', agent.workspace_id)
  const agents = (agentRows as AgentRow[] | null) ?? []
  const agentById = new Map(agents.map((a) => [a.id, a]))
  const teammates: NoteTeammate[] = agents.map((a) => {
    const { name, initials } = nameOf(a)
    // firstName drives the @mention token + picker label; first word of
    // the resolved name keeps email-local fallbacks single-token.
    const firstName = a.first_name?.trim() || name.split(' ')[0] || name
    return { id: a.id, name, firstName, role: a.role, initials }
  })

  let query = admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('notes' as any)
    .select('id, author_id, body, mentions, created_at, edited_at, resolved')
    .order('created_at', { ascending: true })
  query = contactId ? query.eq('contact_id', contactId) : query.eq('property_id', propertyId!)

  const { data: noteRows, error } = await query
  if (error) {
    if (error.code === '42P01') {
      return NextResponse.json({ notes: [], teammates, currentAgentId: agent.id }, { status: 200 })
    }
    console.error('[notes] GET failed:', error)
    return NextResponse.json({ error: 'read_failed' }, { status: 500 })
  }

  const notes: Note[] = ((noteRows as NoteRow[] | null) ?? []).map((r) => {
    const { name, initials } = nameOf(agentById.get(r.author_id))
    return {
      id: r.id,
      authorId: r.author_id,
      authorName: name,
      authorInitials: initials,
      authorRole: agentById.get(r.author_id)?.role ?? null,
      body: r.body,
      mentions: r.mentions ?? [],
      createdAt: r.created_at,
      editedAt: r.edited_at,
      resolved: r.resolved,
    }
  })

  return NextResponse.json({ notes, teammates, currentAgentId: agent.id }, { status: 200 })
}

export async function POST(request: Request) {
  let body: { contactId?: string; propertyId?: string; body?: string; mentions?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 422 })
  }
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  const contactId = body.contactId ?? null
  const propertyId = body.propertyId ?? null
  const mentions = Array.isArray(body.mentions) ? body.mentions.filter((m) => typeof m === 'string') : []
  if (!text) return NextResponse.json({ error: 'body_required' }, { status: 422 })
  if (Boolean(contactId) === Boolean(propertyId)) {
    return NextResponse.json({ error: 'exactly_one_subject' }, { status: 422 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const { admin, agent } = await resolveAgent(user.id)
  if (!agent?.workspace_id) return NextResponse.json({ error: 'no_workspace' }, { status: 401 })

  const { data: inserted, error } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('notes' as any)
    .insert({
      workspace_id: agent.workspace_id,
      author_id: agent.id,
      body: text,
      mentions,
      contact_id: contactId,
      property_id: propertyId,
    } as never)
    .select('id, author_id, body, mentions, created_at, edited_at, resolved')
    .single()

  if (error) {
    if (error.code === '42P01') {
      return NextResponse.json({ error: 'table_missing', message: 'notes migration not applied' }, { status: 503 })
    }
    console.error('[notes] POST failed:', error)
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 })
  }

  // @mention fan-out → notification_log (bell). Skip self-mentions.
  // Property-note mentions still insert but won't render in the Slice-A
  // stream (contact_id null) — bell coverage for contact notes for now.
  const targets = mentions.filter((m) => m && m !== agent.id)
  if (targets.length > 0) {
    const meta = user.user_metadata ?? {}
    const author =
      [meta.first_name, meta.last_name].filter(Boolean).join(' ').trim() ||
      (typeof meta.full_name === 'string' ? meta.full_name.trim() : '') ||
      (user.email ? user.email.split('@')[0] : '')
    const excerpt = text.length > 90 ? `${text.slice(0, 90)}…` : text
    const url = contactId ? `/contacts/${contactId}` : `/properties/${propertyId}`
    await admin.from('notification_log').insert(
      targets.map((agentId) => ({
        agent_id: agentId,
        type: 'note_mention',
        contact_id: contactId,
        title: author ? `${author} mentioned you in a note` : 'You were mentioned in a note',
        body: excerpt,
        url,
        sent_at: new Date().toISOString(),
      })) as never,
    )
  }

  const r = inserted as NoteRow
  return NextResponse.json({ note: { id: r.id } }, { status: 201 })
}
