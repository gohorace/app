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
import { signInDetail } from '@/lib/inspections/aggregates'
import { SummaryStatsRow } from '@/components/inspections/summary-stats-row'
import { SignInTable } from '@/components/inspections/sign-in-table'

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

  // HOR-249: past inspections show analytics, not the QR. "Past" = ended/
  // cancelled OR the scheduled time has passed.
  const isPast =
    inspection.status === 'ended' ||
    inspection.status === 'cancelled' ||
    new Date(inspection.scheduled_at).getTime() < Date.now()

  if (isPast) {
    const { aggregate, rows } = await signInDetail(admin, inspection.id)
    const label = property?.suburb || address.line1
    const day = new Intl.DateTimeFormat('en-AU', { weekday: 'long' }).format(
      new Date(inspection.scheduled_at),
    )
    const voiceLine =
      aggregate.signIns > 0
        ? `${label} picked up ${aggregate.signIns} ${aggregate.signIns === 1 ? 'sign-in' : 'sign-ins'} on ${day}` +
          (aggregate.convertedToActive > 0
            ? ` — ${aggregate.convertedToActive} ${aggregate.convertedToActive === 1 ? 'is' : 'are'} still active.`
            : ` — none have stirred since.`)
        : `Quiet inspection — no one signed in on ${day}.`

    return (
      <div style={{ padding: '24px 20px', maxWidth: 720, margin: '0 auto' }}>
        <div style={{ marginBottom: 6, fontSize: 12, color: '#8C7B6B' }}>
          <Link href="/inspections" style={{ color: '#8C7B6B', textDecoration: 'none' }}>
            ← Inspections
          </Link>
        </div>

        <h1 className="font-display" style={{ fontSize: 24, fontWeight: 500, color: '#3D332B', marginBottom: 4 }}>
          {address.line1}
        </h1>
        {address.line2 && <div style={{ fontSize: 13, color: '#8C7B6B', marginBottom: 4 }}>{address.line2}</div>}
        <div style={{ fontSize: 13, color: '#5E5246', marginBottom: 20 }}>
          {formatScheduledAt(inspection.scheduled_at)} · <span style={{ textTransform: 'capitalize' }}>{inspection.status}</span>
        </div>

        {/* Horace summary strip */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 18px',
            marginBottom: 22,
            background: '#2E2823',
            borderRadius: 10,
            color: 'rgba(245,240,232,0.92)',
          }}
        >
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: '#C4622D', flexShrink: 0 }} />
          <p className="font-display" style={{ margin: 0, fontSize: 14.5, fontStyle: 'italic', lineHeight: 1.5 }}>
            {voiceLine}
          </p>
        </div>

        {/* 4-stat grid */}
        <SummaryStatsRow
          stats={[
            { label: 'Signed in', value: aggregate.signIns },
            { label: 'Still active', value: aggregate.convertedToActive, accent: true },
            { label: 'In pipeline', value: aggregate.addedToPipeline },
            { label: 'Went quiet', value: aggregate.wentQuiet },
          ]}
        />

        <h2
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            color: '#8C7B6B',
            marginBottom: 10,
          }}
        >
          Captured sign-ins
        </h2>
        <SignInTable rows={rows} />
      </div>
    )
  }

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
