/**
 * HOR-204 — Provider-specific DNS-host walkthroughs.
 *
 * Rendered in the pending state of CustomDomainManager. NS detection
 * (lib/dns/detect.ts) classifies the agent's apex zone; this component
 * picks the matching walkthrough. 'other' and 'unknown' fall back to
 * generic numbered steps (the same we always showed pre-Tier-1).
 *
 * Goal: turn "I don't see a CNAME button" into a one-screen click path
 * for each of the four most common DNS hosts. Anything else gets the
 * generic flow plus the "Stuck? email team@gohorace.com" escape.
 */

import { AlertCircle, ExternalLink } from 'lucide-react'

export type DnsProvider =
  | 'cloudflare'
  | 'route53'
  | 'namecheap'
  | 'godaddy'
  | 'vercel'
  | 'other'
  | 'unknown'

interface Props {
  provider: DnsProvider
  hostname: string
  apex: string
  /** Just the subdomain label (e.g. 'inspections' from inspections.example.com.au). */
  subdomainLabel: string
}

export function DnsProviderGuide({ provider, hostname, apex, subdomainLabel }: Props) {
  if (provider === 'cloudflare') {
    return (
      <Walkthrough
        providerName="Cloudflare"
        zoneLink={`https://dash.cloudflare.com/?to=/:account/${apex}/dns/records`}
        steps={[
          <>Open <strong>Cloudflare dashboard</strong> → choose <span className="font-mono">{apex}</span> → <strong>DNS → Records</strong>.</>,
          <>Click <strong>Add record</strong>.</>,
          <>Set <strong>Type</strong> to <span className="font-mono">CNAME</span>, <strong>Name</strong> to <span className="font-mono">{subdomainLabel}</span>, <strong>Target</strong> to <span className="font-mono">cname.vercel-dns.com</span>.</>,
          <><strong>Crucial:</strong> set <strong>Proxy status</strong> to <strong>DNS only</strong> (grey cloud), not Proxied (orange). Vercel handles the certificate — proxying breaks it.</>,
          <>Click <strong>Save</strong>.</>,
        ]}
        warning={{
          title: 'Cloudflare-specific gotcha',
          body: (
            <>
              The grey cloud / orange cloud toggle is the #1 reason setup fails. If
              you see the cloud go orange, click it again — it should flip to grey.
              Proxied records produce an SSL handshake error (525) when an attendee
              opens the link.
            </>
          ),
        }}
      />
    )
  }

  if (provider === 'route53') {
    return (
      <Walkthrough
        providerName="Route 53"
        zoneLink={`https://us-east-1.console.aws.amazon.com/route53/v2/hostedzones`}
        steps={[
          <>Open <strong>Route 53 console</strong> → <strong>Hosted zones</strong> → choose <span className="font-mono">{apex}</span>.</>,
          <>Click <strong>Create record</strong>.</>,
          <>Set <strong>Record name</strong> to <span className="font-mono">{subdomainLabel}</span>, <strong>Record type</strong> to <span className="font-mono">CNAME</span>.</>,
          <>Set <strong>Value</strong> to <span className="font-mono">cname.vercel-dns.com</span>.</>,
          <>Leave <strong>TTL</strong> at <span className="font-mono">300</span> seconds, <strong>Routing policy</strong> at <strong>Simple routing</strong>.</>,
          <>Click <strong>Create records</strong>.</>,
        ]}
      />
    )
  }

  if (provider === 'namecheap') {
    return (
      <Walkthrough
        providerName="Namecheap"
        zoneLink="https://ap.www.namecheap.com/Domains/DomainControlPanel"
        steps={[
          <>Open <strong>Namecheap account → Domain List</strong> → click <strong>Manage</strong> next to <span className="font-mono">{apex}</span>.</>,
          <>Open the <strong>Advanced DNS</strong> tab.</>,
          <>Under <strong>Host Records</strong>, click <strong>Add New Record</strong>.</>,
          <>Set <strong>Type</strong> to <span className="font-mono">CNAME Record</span>, <strong>Host</strong> to <span className="font-mono">{subdomainLabel}</span>, <strong>Value</strong> to <span className="font-mono">cname.vercel-dns.com</span>, <strong>TTL</strong> to <strong>Automatic</strong>.</>,
          <>Click the green tick to save.</>,
        ]}
      />
    )
  }

  if (provider === 'godaddy') {
    return (
      <Walkthrough
        providerName="GoDaddy"
        zoneLink="https://dcc.godaddy.com/control/portfolio"
        steps={[
          <>Open <strong>GoDaddy → My Products → Domains</strong> → find <span className="font-mono">{apex}</span> → click <strong>DNS</strong>.</>,
          <>Click <strong>Add New Record</strong>.</>,
          <>Set <strong>Type</strong> to <span className="font-mono">CNAME</span>, <strong>Name</strong> to <span className="font-mono">{subdomainLabel}</span>, <strong>Value</strong> to <span className="font-mono">cname.vercel-dns.com</span>.</>,
          <>Leave <strong>TTL</strong> at <strong>1 Hour</strong> (or set it to 600 seconds for faster propagation).</>,
          <>Click <strong>Save</strong>.</>,
        ]}
      />
    )
  }

  if (provider === 'vercel') {
    return (
      <Walkthrough
        providerName="Vercel"
        zoneLink={`https://vercel.com/domains/${apex}`}
        steps={[
          <>Open <strong>Vercel dashboard → Domains</strong> → <span className="font-mono">{apex}</span>.</>,
          <>Click <strong>Add Record</strong>.</>,
          <>Set <strong>Type</strong> to <span className="font-mono">CNAME</span>, <strong>Name</strong> to <span className="font-mono">{subdomainLabel}</span>, <strong>Value</strong> to <span className="font-mono">cname.vercel-dns.com</span>.</>,
          <>Click <strong>Save</strong>.</>,
        ]}
      />
    )
  }

  // 'other' / 'unknown' — generic instructions.
  return (
    <Walkthrough
      providerName="your DNS host"
      steps={[
        <>Log in to your DNS host (whoever you registered <span className="font-mono">{apex}</span> with — Cloudflare, Namecheap, Route 53, GoDaddy, OVH, etc.).</>,
        <>Find the <strong>DNS records</strong> or <strong>DNS management</strong> screen for <span className="font-mono">{apex}</span>.</>,
        <>Add a new <strong>CNAME</strong> record with <strong>Name</strong> <span className="font-mono">{subdomainLabel}</span> and <strong>Value</strong> <span className="font-mono">cname.vercel-dns.com</span>.</>,
        <>Save / publish the record.</>,
      ]}
    />
  )
}

function Walkthrough({
  providerName,
  zoneLink,
  steps,
  warning,
}: {
  providerName: string
  zoneLink?: string
  steps: React.ReactNode[]
  warning?: { title: string; body: React.ReactNode }
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xs font-medium text-foreground">
          Setup steps for {providerName}
        </div>
        {zoneLink && (
          <a
            href={zoneLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Open in {providerName}
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      <ol className="ml-4 list-decimal space-y-1.5 text-xs text-muted-foreground">
        {steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>

      {warning && (
        <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <AlertCircle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs text-amber-900">
            <div className="font-medium">{warning.title}</div>
            <p className="text-amber-800">{warning.body}</p>
          </div>
        </div>
      )}
    </div>
  )
}
