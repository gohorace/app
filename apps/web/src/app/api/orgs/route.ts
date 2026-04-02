import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

const createOrgSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
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
  const parsed = createOrgSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { name, email } = parsed.data
  const admin = createAdminClient()

  // Check if user already has an org (prevent duplicates on retry)
  const { data: existing } = await admin
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ orgId: existing.org_id })
  }

  // Generate a unique slug
  let slug = slugify(name)
  const { count } = await admin
    .from('orgs')
    .select('*', { count: 'exact', head: true })
    .eq('slug', slug)

  if (count && count > 0) {
    slug = `${slug}-${Math.floor(Math.random() * 9000) + 1000}`
  }

  // Create org, member, and settings in one DB function call
  const { data: orgId, error } = await admin.rpc('create_org_with_owner', {
    p_user_id: user.id,
    p_name: name,
    p_slug: slug,
    p_email: email,
  })

  if (error) {
    console.error('create_org_with_owner error:', error)
    return NextResponse.json({ error: 'Failed to create organisation' }, { status: 500 })
  }

  return NextResponse.json({ orgId })
}
