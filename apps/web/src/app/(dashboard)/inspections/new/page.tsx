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
import { createAdminClient } from '@/lib/supabase/admin'
import { getVerifiedDomainForWorkspace } from '@/lib/domains/lookup'
import { InspectionsCreateForm } from '@/components/inspections/inspections-create-form'

export const dynamic = 'force-dynamic'

export default async function NewInspectionPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // HOR-204: Doorstep needs a verified custom domain. Surface a hard
  // blocker on the create page so agents never get to the form without
  // a working capture URL.
  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('workspace_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const verifiedHostname = agent?.workspace_id
    ? await getVerifiedDomainForWorkspace(agent.workspace_id)
    : null

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

      {!verifiedHostname ? (
        <div
          style={{
            background: '#FEF3C7',
            border: '1px solid #FCD34D',
            borderRadius: 12,
            padding: 20,
            maxWidth: 540,
          }}
        >
          <div
            style={{
              fontWeight: 600,
              color: '#78350F',
              marginBottom: 6,
              fontSize: 15,
            }}
          >
            Doorstep needs a custom domain.
          </div>
          <p style={{ fontSize: 13, color: '#78350F', marginBottom: 16, lineHeight: 1.5 }}>
            Takes a couple of minutes. Add a subdomain you control and we&apos;ll handle the certificate.
          </p>
          <Link
            href="/settings/custom-domain"
            style={{
              display: 'inline-block',
              background: '#78350F',
              color: '#FEF3C7',
              padding: '8px 16px',
              borderRadius: 6,
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Set up your custom domain →
          </Link>
        </div>
      ) : (
        <InspectionsCreateForm />
      )}
    </div>
  )
}
