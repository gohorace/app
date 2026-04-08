import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  first_name: z.string().max(100).optional(),
  last_name: z.string().max(100).optional(),
})

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

export async function POST(request: NextRequest) {
  // Verify the caller is authenticated
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const parsed = createWorkspaceSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { name, email, first_name, last_name } = parsed.data
  const admin = createAdminClient()

  // Check if user already has a workspace (prevent duplicates on retry)
  const { data: existing } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ workspaceId: existing.workspace_id })
  }

  // Generate a unique slug
  let slug = slugify(name)
  const { count } = await admin
    .from('workspaces')
    .select('*', { count: 'exact', head: true })
    .eq('slug', slug)

  if (count && count > 0) {
    slug = `${slug}-${Math.floor(Math.random() * 9000) + 1000}`
  }

  // Create workspace, member, and agent in one DB function call
  const { data: result, error } = await admin.rpc('create_workspace_with_agent', {
    p_user_id: user.id,
    p_name: name,
    p_slug: slug,
    p_email: email,
    ...(first_name !== undefined && { p_first_name: first_name }),
    ...(last_name !== undefined && { p_last_name: last_name }),
  })

  if (error) {
    console.error('create_workspace_with_agent error:', error)
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
  }

  const { workspace_id: workspaceId, agent_id: agentId } = (result as { workspace_id: string; agent_id: string }[])[0]

  return NextResponse.json({ workspaceId, agentId })
}
