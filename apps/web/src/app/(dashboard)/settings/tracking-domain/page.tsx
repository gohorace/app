/**
 * First-party tracking architecture — /settings/tracking-domain (W2)
 *
 * Server-rendered, owner/admin only. Read-only status view of the
 * workspace's first-party tracking domain(s). Provisioning is
 * support-driven for v1 (the self-serve flow + provision/delete actions
 * arrive with the Cloudflare service in a follow-on PR).
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SectionHeading } from '@/components/ui/section-heading'
import {
  listTrackingDomains,
  type TrackingDomain,
  type TrackingDomainStatus,
} from '@/lib/tracking-domains/queries'

export const dynamic = 'force-dynamic'

const STATUS_COPY: Record<TrackingDomainStatus, { label: string; tone: string }> = {
  pending: { label: 'Pending DNS', tone: 'var(--fg-tertiary)' },
  verifying: { label: 'Verifying', tone: 'var(--fg-secondary)' },
  active: { label: 'Active', tone: 'var(--color-terracotta)' },
  failed: { label: 'Failed', tone: 'var(--color-danger, #c0392b)' },
  deleted: { label: 'Removed', tone: 'var(--fg-tertiary)' },
}

function Shell({ children }: { children: React.ReactNode }) {
  // Own scroll container — dashboard <main> delegates scrolling per page (HOR-297).
  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-4 md:p-8 max-w-[660px] space-y-5">
        <SectionHeading
          title="Tracking domain"
          description="Serve your tracking from your own subdomain (e.g. t.youragency.com.au) so returning-visitor identity survives Safari and ad-blocker filter lists. Your domain, your data."
        />
        {children}
      </div>
    </div>
  )
}

function formatWhen(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function DomainCard({ domain }: { domain: TrackingDomain }) {
  const status = STATUS_COPY[domain.status]
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[13px] text-[var(--fg-primary)]">{domain.hostname}</span>
        <span className="text-[12px] font-medium" style={{ color: status.tone }}>
          {status.label}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
        <dt className="text-[var(--fg-tertiary)]">Apex</dt>
        <dd className="font-mono text-[var(--fg-secondary)]">{domain.apexDomain}</dd>
        <dt className="text-[var(--fg-tertiary)]">Certificate</dt>
        <dd className="text-[var(--fg-secondary)]">{domain.certStatus ?? '—'}</dd>
        <dt className="text-[var(--fg-tertiary)]">Last checked</dt>
        <dd className="text-[var(--fg-secondary)]">{formatWhen(domain.lastCheckedAt)}</dd>
        {domain.failureReason && (
          <>
            <dt className="text-[var(--fg-tertiary)]">Reason</dt>
            <dd className="text-[var(--color-danger,#c0392b)]">{domain.failureReason}</dd>
          </>
        )}
      </dl>
    </div>
  )
}

export default async function TrackingDomainSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', user!.id)
    .maybeSingle()

  if (!membership) {
    return (
      <Shell>
        <p className="text-sm text-[var(--fg-secondary)]">You don&apos;t belong to a workspace yet.</p>
      </Shell>
    )
  }

  if (membership.role !== 'owner' && membership.role !== 'admin') {
    return (
      <Shell>
        <p className="text-sm text-[var(--fg-secondary)]">
          Tracking domains are managed by the workspace owner.
        </p>
      </Shell>
    )
  }

  const domains = await listTrackingDomains(membership.workspace_id)

  return (
    <Shell>
      {domains.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-4">
          <p className="text-sm text-[var(--fg-secondary)]">
            No tracking domain set up yet. Until one is active your snippet keeps using the
            built-in <span className="font-mono">gohorace.com</span> path — nothing breaks.
          </p>
          <p className="mt-2 text-[12px] text-[var(--fg-tertiary)]">
            Setting up a custom tracking domain is currently support-assisted. Contact support to
            get started; self-serve setup is coming soon.
          </p>
        </div>
      ) : (
        domains.map((d) => <DomainCard key={d.id} domain={d} />)
      )}
    </Shell>
  )
}
