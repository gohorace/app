/**
 * HOR-148 — /inspections (agent list view)
 *
 * Two sections: Upcoming (`scheduled_at >= now`) and Past. Each row is a
 * Link to the inspection detail page where the QR lives. Scan counts
 * and revisit indicators land on the detail page (HOR-150 full) — too
 * noisy here, and the agent's main use of this surface is "is the
 * 11am one set up?" not "how did Tuesday's one perform?".
 *
 * Agent-facing copy says "inspection" (forward-looking — covers open
 * homes today, private inspections in v2). Prospect-facing copy on
 * /i/<token> still says "open home" because that's the specific event
 * the prospect is attending.
 */

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { listForAgent } from '@/lib/inspections/repo'
import type { Inspection } from '@/lib/inspections/types'
import {
  aggregatesForInspections,
  type InspectionAggregate,
} from '@/lib/inspections/aggregates'
import { composeInspectionVoice } from '@/lib/inspections/horace-voice'
import { InspectionsAskHorace } from '@/components/inspections/ask-horace-button'
import { SummaryStatsRow } from '@/components/inspections/summary-stats-row'

export const dynamic = 'force-dynamic'

interface PropertyRow {
  id: string
  street_number: string | null
  street_name: string | null
  suburb: string | null
  state: string | null
  postcode: string | null
}

interface InspectionRow extends Inspection {
  address: string
}

function formatAddress(p: PropertyRow | undefined): string {
  if (!p) return 'Property pending'
  const line1 = [p.street_number, p.street_name].filter(Boolean).join(' ').trim()
  const line2 = [p.suburb, p.state].filter(Boolean).join(' ').trim()
  return [line1, line2].filter(Boolean).join(', ') || 'Property pending'
}

function formatScheduledAt(iso: string): string {
  // AU locale, short weekday + 12-hour time. Server-rendered → fixed locale.
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso))
}

// Origin shared with the create + qr endpoints so a preview-minted
// inspection's surfaces all point back at the same deploy. HOR-204:
// when the workspace has a verified custom domain we prefer that; the
// page resolves the origin once and shares it across rows.
function publicUrlBuilder(origin: string): (token: string) => string {
  return (token: string) => `${origin}/i/${token}`
}

export default async function InspectionsPage() {
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

  if (!agent) {
    return (
      <div style={{ padding: '32px 24px' }}>
        <p style={{ color: '#9C4A1F' }}>No agent record found for this user.</p>
      </div>
    )
  }

  // Fetch inspections in parallel with the property join lookup.
  const { upcoming, past } = await listForAgent(admin, agent.id, { limit: 50 })

  const all = [...upcoming, ...past]
  const propertyIds = Array.from(new Set(all.map((i) => i.property_id)))

  let propertyById = new Map<string, PropertyRow>()
  if (propertyIds.length > 0) {
    const { data: properties } = await admin
      .from('properties')
      .select('id, street_number, street_name, suburb, state, postcode')
      .in('id', propertyIds)

    propertyById = new Map((properties ?? []).map((p) => [p.id, p as PropertyRow]))
  }

  const decorate = (rows: Inspection[]): InspectionRow[] =>
    rows.map((i) => ({ ...i, address: formatAddress(propertyById.get(i.property_id)) }))

  const upcomingRows = decorate(upcoming)
  const pastRows = decorate(past)

  const totalCount = all.length

  // HOR-249: live sign-in analytics for the past inspections — one batched
  // read powers the summary row, the per-row chips, and the voice line.
  const pastAgg = await aggregatesForInspections(admin, pastRows.map((r) => r.id))
  const emptyAgg: InspectionAggregate = {
    signIns: 0, convertedToActive: 0, addedToPipeline: 0, wentQuiet: 0,
  }
  const summary = pastRows.reduce(
    (acc, r) => {
      const a = pastAgg.get(r.id) ?? emptyAgg
      acc.signIns += a.signIns
      acc.convertedToActive += a.convertedToActive
      acc.addedToPipeline += a.addedToPipeline
      return acc
    },
    { signIns: 0, convertedToActive: 0, addedToPipeline: 0 },
  )
  const voice = composeInspectionVoice(
    pastRows.map((r) => ({
      label: propertyById.get(r.property_id)?.suburb || r.address,
      scheduledAt: r.scheduled_at,
      aggregate: pastAgg.get(r.id) ?? emptyAgg,
      inspectionId: r.id,
    })),
  )

  return (
    <div style={{ padding: '32px 24px', maxWidth: 960 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <h1
            className="font-display"
            style={{ fontSize: 28, fontWeight: 500, color: '#3D332B', marginBottom: 8 }}
          >
            Inspections
          </h1>
          <p style={{ fontSize: 14, color: '#5E5246', maxWidth: 540 }}>
            Each inspection gets a private sign-in QR. Show it on your phone or print it for the
            bench — every scan turns into a tagged contact you can follow up.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <InspectionsAskHorace />
          <Link
            href="/inspections/new"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 14px',
              fontSize: 13,
              fontWeight: 500,
              background: '#C4622D',
              color: '#FFFFFF',
              borderRadius: 6,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            <Plus style={{ width: 14, height: 14 }} />
            New inspection
          </Link>
        </div>
      </div>

      {/* HOR-249: Horace voice strip — past-week summary in voice. */}
      {voice && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 18px',
            marginBottom: 24,
            background: '#2E2823',
            borderRadius: 10,
            color: 'rgba(245,240,232,0.92)',
          }}
        >
          <span
            aria-hidden
            style={{ width: 7, height: 7, borderRadius: '50%', background: '#C4622D', flexShrink: 0 }}
          />
          <p
            className="font-display"
            style={{ margin: 0, flex: 1, fontSize: 14.5, fontStyle: 'italic', lineHeight: 1.5 }}
          >
            {voice.line}
          </p>
          <Link
            href={`/inspections/${voice.inspectionId}`}
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: '#E8956D',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            See sign-ins →
          </Link>
        </div>
      )}

      {totalCount === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Section title="Upcoming" rows={upcomingRows} emptyLine="Nothing scheduled — yet." />
          {pastRows.length > 0 && summary.signIns > 0 && (
            <SummaryStatsRow
              stats={[
                { label: 'Sign-ins captured', value: summary.signIns },
                { label: 'Now active', value: summary.convertedToActive, accent: true },
                { label: 'In pipeline', value: summary.addedToPipeline },
              ]}
            />
          )}
          <Section title="Past" rows={pastRows} emptyLine="Nothing finished yet." agg={pastAgg} />
        </>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div
      style={{
        padding: '48px 24px',
        textAlign: 'center',
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.2)',
        borderRadius: 10,
      }}
    >
      <p style={{ fontSize: 13, fontWeight: 500, color: '#5E5246', marginBottom: 6 }}>
        Horace hasn&rsquo;t hosted any inspections for you yet.
      </p>
      <p style={{ fontSize: 12, color: '#8C7B6B', marginBottom: 18 }}>
        Set one up and Horace will mint a private sign-in QR for it.
      </p>
      <Link
        href="/inspections/new"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px',
          fontSize: 13,
          fontWeight: 500,
          background: '#C4622D',
          color: '#FFFFFF',
          borderRadius: 6,
          textDecoration: 'none',
        }}
      >
        <Plus style={{ width: 14, height: 14 }} />
        New inspection
      </Link>
    </div>
  )
}

function SignInChips({ aggregate }: { aggregate: InspectionAggregate | undefined }) {
  const a = aggregate ?? { signIns: 0, convertedToActive: 0, addedToPipeline: 0, wentQuiet: 0 }
  const chip = (label: string, value: number, accent: boolean) => (
    <span
      style={{
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color: accent ? '#A85220' : '#5E5246',
        background: accent ? 'rgba(196,98,45,0.1)' : 'rgba(140,123,107,0.1)',
        padding: '2px 8px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {value} {label}
    </span>
  )
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      {chip('sign-ins', a.signIns, false)}
      {chip('active', a.convertedToActive, true)}
      {chip('pipeline', a.addedToPipeline, false)}
    </div>
  )
}

function Section({
  title,
  rows,
  emptyLine,
  agg,
}: {
  title: string
  rows: InspectionRow[]
  emptyLine: string
  /** HOR-249: when present (past section), render per-row sign-in chips. */
  agg?: Map<string, InspectionAggregate>
}) {
  return (
    <div style={{ marginBottom: 32 }}>
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
        {title}
      </h2>
      {rows.length === 0 ? (
        <div
          style={{
            padding: '20px 16px',
            background: '#FAF7F2',
            border: '1px solid rgba(140,123,107,0.2)',
            borderRadius: 10,
            fontSize: 12,
            color: '#8C7B6B',
          }}
        >
          {emptyLine}
        </div>
      ) : (
        <div
          style={{
            background: '#FAF7F2',
            border: '1px solid rgba(140,123,107,0.2)',
            borderRadius: 10,
            overflow: 'hidden',
          }}
        >
          {rows.map((row, idx) => (
            <Link
              key={row.id}
              href={`/inspections/${row.id}`}
              style={{
                padding: '14px 16px',
                borderTop: idx === 0 ? 'none' : '1px solid rgba(140,123,107,0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  className="font-display"
                  style={{ fontSize: 15, color: '#3D332B', marginBottom: 2 }}
                >
                  {row.address}
                </div>
                <div style={{ fontSize: 12, color: '#8C7B6B' }}>{formatScheduledAt(row.scheduled_at)}</div>
              </div>
              {/* HOR-249: past rows show sign-in chips; upcoming rows show the QR cue. */}
              {agg ? (
                <SignInChips aggregate={agg.get(row.id)} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span style={{ fontSize: 11, color: '#C4622D', fontWeight: 500 }}>Show QR →</span>
                  <span style={{ fontSize: 10, color: '#8C7B6B', textTransform: 'capitalize' }}>{row.status}</span>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
