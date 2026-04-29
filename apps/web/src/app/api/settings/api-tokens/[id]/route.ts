import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('workspace_api_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .is('revoked_at', null)

  if (error) {
    console.error('Token revoke failed:', error)
    return NextResponse.json({ error: 'Failed to revoke token' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
