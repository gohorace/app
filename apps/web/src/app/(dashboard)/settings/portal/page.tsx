import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CopyButton } from '@/components/ui/copy-button'

const PORTAL_DOMAIN = 'portal.gohorace.com'

export default async function PortalAddressPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

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

  // Own scroll container — dashboard <main> delegates scrolling per page (HOR-297).
  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-4 md:p-8 space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Portal address</h1>
          <p className="text-muted-foreground">
            Your unique inbox for capturing portal enquiries into Horace
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Your address</CardTitle>
            <CardDescription>
              {fullAddress
                ? 'Add this email address to your portal listings (REA, Domain) so enquiries flow into Horace.'
                : 'Your portal address hasn’t been generated yet — contact support to enable portal capture.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {fullAddress ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted px-4 py-3">
                <code className="text-sm font-mono break-all">{fullAddress}</code>
                <CopyButton text={fullAddress} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No active address on file.</p>
            )}
          </CardContent>
        </Card>

        {fullAddress && (
          <Card>
            <CardHeader>
              <CardTitle>How to use it</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-3">
              <p>
                On each portal listing you manage, find the enquiry-email field and{' '}
                <strong className="text-foreground">add your Horace address alongside</strong>{' '}
                your existing emails. Don&rsquo;t replace them — keep your own inbox and any CRM
                capture address (e.g. Rex, Agentbox) so nothing is lost.
              </p>
              <div className="text-xs">
                <p className="font-medium text-foreground mb-1">Example for REA:</p>
                <code className="block bg-muted px-3 py-2 rounded text-xs whitespace-pre-wrap break-all">
                  you@youragency.com.au, your-crm-address@..., {fullAddress}
                </code>
              </div>
              <ul className="space-y-1.5 list-disc list-inside pt-1">
                <li>Each enquiry creates (or matches) a contact in Horace within ~30 seconds.</li>
                <li>
                  Source attribution: contacts arriving via this address are tagged{' '}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">source=portal</code> with{' '}
                  the originating portal as <code className="text-xs bg-muted px-1 py-0.5 rounded">medium</code>.
                </li>
                <li>The address is unique to you — don&rsquo;t share it publicly.</li>
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
