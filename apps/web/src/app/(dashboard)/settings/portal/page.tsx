import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { Check } from 'lucide-react'
import { SectionHeading } from '@/components/ui/section-heading'
import { CardLabel } from '@/components/ui/card-label'
import { CodeBlock } from '@/components/ui/code-block'

const PORTAL_DOMAIN = 'portal.gohorace.com'

export default async function PortalAddressPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const { data: address } = agent?.id
    ? await admin
        .from('agent_inbound_addresses')
        .select('local_part, created_at')
        .eq('agent_id', agent.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null }

  const fullAddress = address ? `${address.local_part}@${PORTAL_DOMAIN}` : null
  const example = fullAddress
    ? `you@youragency.com.au, your-crm@inbound.crm.com, ${fullAddress}`
    : null

  const points = [
    'Each enquiry creates or matches a contact in Horace within ~30 seconds.',
    'Captured leads are tagged source = portal, with the originating portal as the medium.',
    "The address is unique to you — don't share it publicly.",
  ]

  // Own scroll container — dashboard <main> delegates scrolling per page (HOR-297).
  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-4 md:p-8">
        <div className="max-w-[660px] space-y-4">
          <SectionHeading
            title="Portal address"
            description="Your unique inbox for capturing REA and Domain enquiries straight into Horace."
          />

          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[22px] shadow-[var(--shadow-sm)]">
            <CardLabel>Your portal address</CardLabel>
            {fullAddress ? (
              <>
                <CodeBlock code={fullAddress} />
                <p className="mt-3 text-xs leading-relaxed text-[var(--fg-secondary)]">
                  Add this address to your portal listings (REA, Domain) alongside your existing
                  enquiry emails. Don&apos;t replace them — keep your own inbox and any CRM address
                  too.
                </p>
              </>
            ) : (
              <p className="text-sm text-[var(--fg-secondary)]">
                Your portal address hasn&apos;t been generated yet — contact support to enable portal
                capture.
              </p>
            )}
          </div>

          {fullAddress && example && (
            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[22px] shadow-[var(--shadow-sm)]">
              <CardLabel>How it works</CardLabel>
              <div className="mb-3 text-xs text-[var(--fg-secondary)]">
                Example enquiry-email field for an REA listing:
              </div>
              <CodeBlock code={example} />
              <ul className="mt-3.5 flex flex-col gap-2">
                {points.map((t) => (
                  <li
                    key={t}
                    className="flex gap-2 text-xs leading-relaxed text-[var(--fg-secondary)]"
                  >
                    <Check className="mt-0.5 size-3.5 shrink-0 text-[var(--color-moss)]" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
