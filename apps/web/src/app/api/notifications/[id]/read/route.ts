import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Optional body `{ read?: boolean }` — HOR-234 kebab toggles read state both
  // ways. Defaults to read=true so existing callers (tap-to-open) are unchanged.
  const body = (await req.json().catch(() => null)) as { read?: boolean } | null
  const markRead = body?.read !== false

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('notification_log')
    .update({ read_at: markRead ? new Date().toISOString() : null })
    .eq('id', id)

  if (error) {
    console.error('[activity] mark-read failed:', error)
    return NextResponse.json({ error: 'Failed to mark read' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
