/**
 * HOR-150 (minimum viable) — /inspections/[id]
 *
 * Agent-facing detail page. The primary job is "show the QR big enough
 * that someone can scan it from a phone held up next to it" — agents
 * typically display this on their own phone at the open home rather
 * than print it.
 *
 * v1 scope (this commit):
 *   - Property address + scheduled time header
 *   - Large inline QR (rendered server-side as a data URL via
 *     lib/inspections/qr.qrDataUrl — no second fetch)
 *   - Public capture URL shown beneath the QR for sanity-check / paste
 *   - 'Download for printing' link to the existing PNG endpoint
 *
 * Deferred to HOR-150 full:
 *   - Scan list (names, captured_at relative time, revisit indicator)
 *   - Live scan counter / poll
 *   - 'Cancel inspection' affordance
 *
 * Auth: 404 on inspections owned by other agents (no existence leak).
 */

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { qrDataUrl } from '@/lib/inspections/qr'
import { inspectionOrigin, inspectionPublicUrl } from '@/lib/inspections/origin'
import { getVerifiedDomainForWorkspace } from '@/lib/domains/lookup'
import { ShareLinkBlock } from '@/components/inspections/share-link-block'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

interface InspectionRow {
  id: string
  agent_id: string
  property_id: string
  token: string
  scheduled_at: string
  window_end_at: string | null
  status: 'scheduled' | 'live' | 'ended' | 'cancelled'
  deleted_at: string | null
}

interface PropertyRow {
  street_number: string | null
  street_name: string | null
  suburb: string | null
  state: string | null
  postcode: string | null
}

function formatScheduledAt(iso: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso))
}

function formatAddress(p: PropertyRow | null): { line1: string; line2: string } {
  if (!p) return { line1: 'Property pending', line2: '' }
  const line1 = [p.street_number, p.street_name].filter(Boolean).join(' ').trim()
  const line2 = [p.suburb, p.state, p.postcode].filter(Boolean).join(' ').trim()
  return { line1: line1 || 'Property pending', line2 }
}

export default async function InspectionDetailPage({ params }: PageProps) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!agent) notFound()

  const { data: inspectionRow } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('inspections' as never)
    .select('id, agent_id, property_id, token, scheduled_at, window_end_at, status, deleted_at')
    .eq('id', id)
    .maybeSingle()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inspection = inspectionRow as InspectionRow | null
  if (!inspection || inspection.deleted_at || inspection.agent_id !== agent.id) notFound()

  const { data: propertyRow } = await admin
    .from('properties')
    .select('street_number, street_name, suburb, state, postcode')
    .eq('id', inspection.property_id)
    .maybeSingle()

  const property = propertyRow as PropertyRow | null
  const address = formatAddress(property)

  const verifiedHostname = agent.workspace_id
    ? await getVerifiedDomainForWorkspace(agent.workspace_id)
    : null
  const publicUrl = agent.workspace_id
    ? await inspectionPublicUrl(agent.workspace_id, inspection.token)
    : `${inspectionOrigin()}/i/${inspection.token}`

  const qr = await qrDataUrl(publicUrl)

  return (
    <div style={{ padding: '24px 20px', maxWidth: 520, margin: '0 auto' }}>
      <div style={{ marginBottom: 6, fontSize: 12, color: '#8C7B6B' }}>
        <Link href="/inspections" style={{ color: '#8C7B6B', textDecoration: 'none' }}>
          ← Inspections
        </Link>
      </div>

      <h1
        className="font-display"
        style={{ fontSize: 24, fontWeight: 500, color: '#3D332B', marginBottom: 4 }}
      >
        {address.line1}
      </h1>
      {address.line2 && (
        <div style={{ fontSize: 13, color: '#8C7B6B', marginBottom: 4 }}>{address.line2}</div>
      )}
      <div style={{ fontSize: 13, color: '#5E5246', marginBottom: 4 }}>
        {formatScheduledAt(inspection.scheduled_at)}
      </div>
      <div style={{ fontSize: 11, color: '#8C7B6B', textTransform: 'capitalize', marginBottom: 24 }}>
        Status: {inspection.status}
      </div>

      {!verifiedHostname && (
        <div
          style={{
            background: '#FEF3C7',
            border: '1px solid #FCD34D',
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontSize: 13,
            color: '#78350F',
          }}
        >
          Doorstep capture paused — restore your custom domain to keep capturing.{' '}
          <Link href="/settings/custom-domain" style={{ color: '#78350F', textDecoration: 'underline' }}>
            Set one up →
          </Link>
        </div>
      )}

      {/* QR — primary affordance. Big, contrast-rich, scannable from ~30cm. */}
      <div
        style={{
          background: '#FFFFFF',
          border: '1px solid rgba(140,123,107,0.2)',
          borderRadius: 12,
          padding: 20,
          textAlign: 'center',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qr}
          alt="Open home sign-in QR code"
          style={{
            width: '100%',
            maxWidth: 360,
            height: 'auto',
            display: 'block',
            margin: '0 auto',
            // Prevent iOS image long-press menu from feeling weird —
            // the agent might hand the phone over to a prospect, but
            // saving the QR is still a useful operation.
          }}
        />
        <p
          style={{
            fontSize: 12,
            color: '#8C7B6B',
            marginTop: 12,
            marginBottom: 0,
          }}
        >
          Hold your phone up and let your guest scan with theirs.
        </p>
      </div>

      <ShareLinkBlock url={publicUrl} />

      <div style={{ marginTop: 18, fontSize: 13 }}>
        <a
          href={`/api/inspections/${inspection.id}/qr`}
          style={{ color: '#C4622D', textDecoration: 'none', fontWeight: 500 }}
        >
          Download for printing →
        </a>
      </div>
    </div>
  )
}
