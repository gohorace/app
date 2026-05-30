/**
 * /settings/import — Import contacts (within the settings shell).
 *
 * Inherits the (dashboard)/settings/layout.tsx so the secondary nav
 * stays visible, matching the settings shell pattern for all other sections.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { formatDistanceToNow } from 'date-fns'
import { SectionHeading } from '@/components/ui/section-heading'
import { CardLabel } from '@/components/ui/card-label'
import { Badge } from '@/components/ui/badge'
import { ImportForm } from '@/components/import/import-form'

const STATUS_VARIANT: Record<string, 'moss' | 'amber' | 'stone' | 'accent'> = {
  complete: 'moss',
  processing: 'amber',
  pending: 'stone',
  error: 'accent',
}

// Own scroll container — dashboard <main> delegates scrolling per page (HOR-297).
export default async function SettingsImportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const { data: imports } = agent
    ? await admin
        .from('crm_imports')
        .select('id, filename, row_count, created_count, matched_count, skipped_count, status, created_at')
        .eq('agent_id', agent.id)
        .order('created_at', { ascending: false })
        .limit(10)
    : { data: [] }

  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-4 md:p-8 max-w-[660px] space-y-5">
        <SectionHeading
          title="Import contacts"
          description="Upload a CSV to sync your contacts with Horace. Existing contacts are matched by email and updated; new ones are created."
        />

        {/* Upload card */}
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[22px] shadow-[var(--shadow-sm)]">
          <CardLabel>CSV import</CardLabel>
          <ImportForm />
        </div>

        {/* History */}
        {imports && imports.length > 0 && (
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
            <div className="border-b border-[var(--border-subtle)] px-4 py-3">
              <CardLabel className="mb-0">Import history</CardLabel>
            </div>
            {imports.map((imp, i) => (
              <div
                key={imp.id}
                className={[
                  'flex items-center justify-between gap-4 px-4 py-3',
                  i < imports.length - 1 ? 'border-b border-[var(--border-subtle)]' : '',
                ].join(' ')}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--fg-primary)]">
                    {imp.filename ?? 'Unknown file'}
                  </p>
                  <p className="text-xs text-[var(--fg-secondary)]">
                    {formatDistanceToNow(new Date(imp.created_at), { addSuffix: true })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm tabular-nums text-[var(--fg-primary)]">
                      <span className="font-medium text-[var(--color-moss)]">{imp.created_count ?? 0} new</span>
                      <span className="text-[var(--fg-secondary)]"> · {imp.matched_count ?? 0} updated</span>
                    </p>
                    <p className="text-xs text-[var(--fg-tertiary)]">{imp.row_count ?? 0} total rows</p>
                  </div>
                  {imp.status && (
                    <Badge variant={STATUS_VARIANT[imp.status] ?? 'stone'} dot>
                      {imp.status}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
