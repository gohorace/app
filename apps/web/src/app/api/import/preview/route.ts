import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { previewCsv } from '@/lib/crm/csv-parser'

// POST /api/import/preview
// Returns headers, detected field mapping, total row count, and a sample
// of the first few rows so the agent can confirm/override before the full
// import. Stateless — file is re-uploaded with /api/import on confirm.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  }

  const csvText = await (file as File).text()
  const preview = previewCsv(csvText)

  if (preview.headers.length === 0) {
    return NextResponse.json(
      { error: 'CSV has no headers. The first row must contain column names.' },
      { status: 422 },
    )
  }

  return NextResponse.json({ ok: true, ...preview })
}
