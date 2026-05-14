/**
 * HOR-148 — /inspections (Open homes list)
 *
 * Agent's list view of Doorstep inspections. Two sections:
 *   - Upcoming (scheduled_at >= now)
 *   - Past     (scheduled_at < now)
 *
 * Each row shows property address, scheduled time, and the public QR
 * URL (`horace.app/i/<token>`) ready to copy. Scan counts and revisit
 * indicators land on the detail page (HOR-150) — too noisy for the
 * list view, and the agent's main use of this surface is "is the open
 * home for 11am set up?" not "how did Tuesday's one perform?".
 *
 * v1 only writes inspection_type='open_home', so user-facing labels say
 * "open home" throughout. v2 (private inspections) branches the wording.
 */

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { listForAgent } from '@/lib/inspections/repo'
import type { Inspection } from '@/lib/inspections/types'

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

function publicUrl(token: string): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://horace.app'
  return `${origin}/i/${token}`
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
            Open homes
          </h1>
          <p style={{ fontSize: 14, color: '#5E5246', maxWidth: 540 }}>
            Each open home gets a private sign-in QR. Print it, prop it on the bench, and Horace
            will turn every scan into a tagged contact you can follow up.
          </p>
        </div>
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
          New open home
        </Link>
      </div>

      {totalCount === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Section title="Upcoming" rows={upcomingRows} emptyLine="Nothing scheduled — yet." />
          <Section title="Past" rows={pastRows} emptyLine="Nothing finished yet." />
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
        Horace hasn&rsquo;t hosted any open homes for you yet.
      </p>
      <p style={{ fontSize: 12, color: '#8C7B6B', marginBottom: 18 }}>
        Set one up and Horace will give you a sign-in QR for the bench.
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
        New open home
      </Link>
    </div>
  )
}

function Section({
  title,
  rows,
  emptyLine,
}: {
  title: string
  rows: InspectionRow[]
  emptyLine: string
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
            <div
              key={row.id}
              style={{
                padding: '14px 16px',
                borderTop: idx === 0 ? 'none' : '1px solid rgba(140,123,107,0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
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
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                <code
                  style={{
                    fontSize: 11,
                    fontFamily: 'var(--font-mono)',
                    color: '#5E5246',
                    background: '#FFFFFF',
                    padding: '4px 8px',
                    borderRadius: 4,
                    border: '1px solid rgba(140,123,107,0.15)',
                  }}
                >
                  {publicUrl(row.token)}
                </code>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <a
                    href={`/api/inspections/${row.id}/qr`}
                    style={{
                      fontSize: 11,
                      color: '#C4622D',
                      textDecoration: 'none',
                      fontWeight: 500,
                    }}
                  >
                    Download QR
                  </a>
                  <span style={{ fontSize: 10, color: '#8C7B6B' }}>{row.status}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
