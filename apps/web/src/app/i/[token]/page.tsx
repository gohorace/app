/**
 * HOR-151 — /i/[token]  (public Doorstep capture page)
 *
 * Prospect-facing surface. Resolves the token to its agent + property,
 * renders an agent-branded two-field form. Horace is invisible:
 *
 *   - No Horace wordmark, no Horace footer, no "Powered by"
 *   - User-facing strings from the brief verbatim ("Sign in to today's
 *     open home", "So <Agent> can follow up.", "Done", "Thanks…")
 *   - Page title is the agent's name; no Horace metadata
 *
 * Server-side, we resolve the token via the inspections repo helper
 * (which already joins agent + property + workspace). 404 surface is
 * a generic non-branded "this open home isn't accepting sign-ins" —
 * keeps malicious / random URL hits from leaking Horace-style copy.
 *
 * ── Cross-domain attribution caveat ─────────────────────────────────
 * The brief's "subsequent visits attributed to the named contact"
 * promise depends on the prospect's _riq_aid cookie being readable by
 * the agent's tracker on the AGENT'S domain. This page lives on
 * gohorace.com (or wherever NEXT_PUBLIC_APP_URL points), so the cookie
 * we set here is on gohorace.com — different origin from agent-domain.com.
 * Subsequent visits to the agent's tracked site will see a fresh
 * tracker-set cookie there, with no link back to the Doorstep capture.
 *
 * v1 still delivers: name + mobile capture, contact creation in
 * Horace's data layer, immediate push to the agent. The cross-domain
 * stitch lands in v2 alongside per-agent custom domains (which puts
 * the capture page on the agent's domain → cookies become first-party
 * to the agent's site → tracker reads them on return visits).
 */

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { getByToken } from '@/lib/inspections/repo'
import { isWellFormed } from '@/lib/inspections/tokens'
import { InspectionCaptureForm } from '@/components/inspections/inspection-capture-form'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ token: string }>
}

async function resolveToken(token: string) {
  if (!isWellFormed(token)) return null
  const admin = createAdminClient()
  return getByToken(admin, token)
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params
  const data = await resolveToken(token)
  if (!data) return { title: 'Open home sign-in' }
  const name = [data.agent.first_name, data.agent.last_name].filter(Boolean).join(' ').trim()
  return {
    title: name ? `Sign in — ${name}` : 'Open home sign-in',
    description: '',
    robots: { index: false, follow: false },
  }
}

export default async function PublicCapturePage({ params }: PageProps) {
  const { token } = await params

  if (!isWellFormed(token)) notFound()

  const data = await resolveToken(token)
  if (!data) notFound()

  // Status / soft-delete guard. The shared getByToken already filters
  // deleted_at IS NULL and status != 'cancelled', but defending in depth
  // here keeps the 404 surface consistent if the helper signature shifts.
  if (data.inspection.status === 'cancelled') notFound()

  // HOR-158 — scan telemetry. A structured log line per server render
  // gives us the denominator for scan-to-submit conversion via Vercel
  // log search (`doorstep_event=inspection_page_view inspection_id=...`).
  // Cheap: no DB write, no second fetch. Caveat: prefetch + cancelled
  // visits also log, so the metric will read slightly hot — fine for v1.
  console.log(
    JSON.stringify({
      doorstep_event: 'inspection_page_view',
      inspection_id: data.inspection.id,
      inspection_type: data.inspection.inspection_type,
      workspace_id: data.workspace.id,
      ts: new Date().toISOString(),
    }),
  )

  const agentFirstName = data.agent.first_name?.trim() || 'the agent'
  const fullName = [data.agent.first_name, data.agent.last_name].filter(Boolean).join(' ').trim() ||
    'Your agent'
  const property = data.property
  const addressLine1 = [property.street_number, property.street_name]
    .filter(Boolean)
    .join(' ')
    .trim()
  const addressLine2 = [property.suburb, property.state, property.postcode]
    .filter(Boolean)
    .join(' ')
    .trim()

  return (
    <main
      style={{
        minHeight: '100dvh',
        background: '#FAF7F2',
        padding: '32px 20px',
        fontFamily: 'var(--font-body, system-ui)',
        color: '#3D332B',
      }}
    >
      <div style={{ maxWidth: 420, margin: '0 auto' }}>
        {/* Agent identity — first thing the prospect sees */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          {data.agent.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.agent.avatar_url}
              alt={fullName}
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                margin: '0 auto 12px',
                display: 'block',
                objectFit: 'cover',
                border: '2px solid rgba(140,123,107,0.2)',
              }}
            />
          ) : (
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                margin: '0 auto 12px',
                background: 'rgba(140,123,107,0.15)',
                color: '#5E5246',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                fontWeight: 500,
              }}
              aria-hidden="true"
            >
              {(data.agent.first_name?.[0] ?? '?') + (data.agent.last_name?.[0] ?? '')}
            </div>
          )}
          <div
            className="font-display"
            style={{ fontSize: 18, fontWeight: 500, color: '#3D332B' }}
          >
            {fullName}
          </div>
        </div>

        {/* Brief-verbatim H1 + subhead */}
        <h1
          className="font-display"
          style={{
            fontSize: 28,
            fontWeight: 500,
            color: '#3D332B',
            marginBottom: 8,
            textAlign: 'center',
            lineHeight: 1.2,
          }}
        >
          Sign in to today&rsquo;s open home
        </h1>
        <p
          style={{
            fontSize: 14,
            color: '#5E5246',
            textAlign: 'center',
            marginBottom: 12,
          }}
        >
          So {agentFirstName} can follow up.
        </p>

        {/* Property */}
        {(addressLine1 || addressLine2) && (
          <div
            style={{
              fontSize: 12,
              color: '#8C7B6B',
              textAlign: 'center',
              marginBottom: 28,
              padding: '10px 14px',
              background: 'rgba(255,255,255,0.7)',
              border: '1px solid rgba(140,123,107,0.15)',
              borderRadius: 6,
            }}
          >
            {addressLine1 && <div>{addressLine1}</div>}
            {addressLine2 && (
              <div style={{ marginTop: 2 }}>{addressLine2}</div>
            )}
          </div>
        )}

        <InspectionCaptureForm
          token={token}
          agentFirstName={agentFirstName}
          brandColour={null /* HOR-151 v1: no brand-colour column on agents yet — defaults inside the form */}
        />
      </div>
    </main>
  )
}

// The route-scoped not-found.tsx renders when any of the notFound() calls
// above fire. Generic, no Horace voice, no link back to the dashboard.
