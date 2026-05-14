/**
 * HOR-148 — /inspections/new
 *
 * Server-component shell that gates the create form behind an auth
 * check, then renders the client component. Form submits to
 * /api/inspections (HOR-148 POST handler), which generates the public
 * token and creates the inspection row.
 */

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { InspectionsCreateForm } from '@/components/inspections/inspections-create-form'

export const dynamic = 'force-dynamic'

export default async function NewInspectionPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div style={{ padding: '32px 24px', maxWidth: 720 }}>
      <div style={{ marginBottom: 6, fontSize: 12, color: '#8C7B6B' }}>
        <Link href="/inspections" style={{ color: '#8C7B6B', textDecoration: 'none' }}>
          ← Inspections
        </Link>
      </div>
      <h1
        className="font-display"
        style={{ fontSize: 28, fontWeight: 500, color: '#3D332B', marginBottom: 8 }}
      >
        Create an inspection
      </h1>
      <p style={{ fontSize: 14, color: '#5E5246', marginBottom: 24, maxWidth: 540 }}>
        Pick the property, when it starts, and how long it runs. Horace generates a private
        sign-in QR you can show on screen or print.
      </p>
      <InspectionsCreateForm />
    </div>
  )
}
