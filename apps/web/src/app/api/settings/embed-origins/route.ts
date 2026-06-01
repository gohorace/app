/**
 * HOR-285 — manage the website embed's allowed origins.
 *
 *   GET    /api/settings/embed-origins          — list the workspace's origins
 *   POST   /api/settings/embed-origins {origin}  — add one (normalised to bare host)
 *   DELETE /api/settings/embed-origins?origin=…  — remove one
 *
 * Stored in workspace_settings.snippet_domains (text[]). These are the sites
 * the embed (HOR-283/284) accepts submissions from — the capture endpoint
 * HARD-rejects anything not listed. Verified Doorstep custom domains are
 * auto-allowed at the endpoint, so they are not stored here.
 *
 * Normalised with the same helper the endpoint uses, so the stored value and
 * the runtime check agree (bare, www/port-stripped host).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'
import { normalizeHost } from '@/lib/doorstep/embed-origin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

async function resolveWorkspaceId(): Promise<string | NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const agent = await resolvePrimaryAgent(admin, user.id, { requireWorkspace: true })
  if (!agent?.workspace_id) return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  return agent.workspace_id as string
}

async function currentOrigins(admin: Admin, workspaceId: string): Promise<string[]> {
  const { data } = await admin
    .from('workspace_settings')
    .select('snippet_domains')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  return (data?.snippet_domains as string[] | undefined) ?? []
}

async function saveOrigins(admin: Admin, workspaceId: string, origins: string[]): Promise<boolean> {
  const { error } = await admin
    .from('workspace_settings')
    .upsert(
      { workspace_id: workspaceId, snippet_domains: origins, updated_at: new Date().toISOString() },
      { onConflict: 'workspace_id' },
    )
  if (error) console.error('[embed-origins] save error:', error)
  return !error
}

// localhost (dev) or a plausible domain.
function isValidHost(host: string): boolean {
  return host === 'localhost' || /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host)
}

export async function GET() {
  const ws = await resolveWorkspaceId()
  if (typeof ws !== 'string') return ws
  return NextResponse.json({ origins: await currentOrigins(createAdminClient(), ws) })
}

const ADD_SCHEMA = z.object({ origin: z.string().min(1).max(253) })

export async function POST(req: NextRequest) {
  const ws = await resolveWorkspaceId()
  if (typeof ws !== 'string') return ws

  const parsed = ADD_SCHEMA.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const host = normalizeHost(parsed.data.origin)
  if (!host || !isValidHost(host)) {
    return NextResponse.json(
      { error: 'Enter a valid site domain, e.g. youragency.com.au' },
      { status: 400 },
    )
  }

  const admin = createAdminClient()
  const origins = await currentOrigins(admin, ws)
  if (origins.includes(host)) return NextResponse.json({ origins }) // idempotent
  const next = [...origins, host]
  if (!(await saveOrigins(admin, ws, next))) {
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
  return NextResponse.json({ origins: next })
}

export async function DELETE(req: NextRequest) {
  const ws = await resolveWorkspaceId()
  if (typeof ws !== 'string') return ws

  const host = normalizeHost(new URL(req.url).searchParams.get('origin'))
  if (!host) return NextResponse.json({ error: 'Missing origin' }, { status: 400 })

  const admin = createAdminClient()
  const origins = await currentOrigins(admin, ws)
  const next = origins.filter((o) => o !== host)
  if (!(await saveOrigins(admin, ws, next))) {
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
  return NextResponse.json({ origins: next })
}
