import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { CopyButton } from '@/components/ui/copy-button'

export const dynamic = 'force-dynamic'

interface Props {
  params: { siteId: string }
}

export default async function InstallPage({ params }: Props) {
  const { siteId } = params
  // siteId is the workspace's snippet_key. Strict UUID validation guards the
  // lookup; anything else 404s without hitting the DB.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(siteId)
  if (!isUuid) notFound()

  const admin = createAdminClient()
  const { data: workspace } = await admin
    .from('workspaces')
    .select('id, name, snippet_key')
    .eq('snippet_key', siteId)
    .maybeSingle()

  if (!workspace) notFound()

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.gohorace.com'
  const snippet = `<!-- Horace -->
<script>
  window.RIQ = {
    key: '${workspace.snippet_key}',
    apiUrl: '${appUrl}/api',
    propertyPattern: '/property/'
  };
</script>
<script src="${appUrl}/tracker.min.js" defer></script>`

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--color-parchment)',
        color: 'var(--color-ink)',
        padding: '64px 24px',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <span style={{
            width: 10, height: 10, borderRadius: '50%', background: 'var(--color-terracotta)',
          }} />
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: '-0.02em',
          }}>Horace</span>
        </div>

        <p style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--color-stone-aa)',
          marginBottom: 12,
        }}>
          Install snippet for {workspace.name}
        </p>

        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 36,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          lineHeight: 1.15,
          marginBottom: 16,
        }}>
          Three steps to get Horace listening.
        </h1>

        <p style={{
          fontSize: 16,
          lineHeight: 1.65,
          color: 'var(--color-stone-aa)',
          maxWidth: 560,
          marginBottom: 36,
        }}>
          Paste the snippet below into the <code style={inlineCode}>&lt;head&gt;</code> of every page on the website. The moment a real visitor lands, Horace confirms it’s working — no further action needed.
        </p>

        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 28 }}>
          <li style={stepBlock}>
            <span style={stepNum}>1</span>
            <div style={{ flex: 1 }}>
              <h2 style={stepHeading}>Copy the snippet</h2>
              <p style={stepBody}>It’s safe to paste this anywhere in <code style={inlineCode}>&lt;head&gt;</code>. No customer data leaves the browser until a visit happens.</p>
              <div style={{
                marginTop: 16,
                background: 'var(--color-charcoal)',
                color: 'var(--color-cream)',
                borderRadius: 12,
                overflow: 'hidden',
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'rgba(0,0,0,0.18)',
                }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'rgba(245,240,232,0.65)',
                  }}>Snippet</span>
                  <CopyButton text={snippet} />
                </div>
                <pre style={{
                  margin: 0,
                  padding: 16,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}><code>{snippet}</code></pre>
              </div>
            </div>
          </li>

          <li style={stepBlock}>
            <span style={stepNum}>2</span>
            <div style={{ flex: 1 }}>
              <h2 style={stepHeading}>Paste before <code style={inlineCode}>&lt;/head&gt;</code></h2>
              <p style={stepBody}>
                On most sites, this lives in your theme’s <code style={inlineCode}>head.html</code>, layout file, or via a tag manager. Save and publish.
              </p>
            </div>
          </li>

          <li style={stepBlock}>
            <span style={stepNum}>3</span>
            <div style={{ flex: 1 }}>
              <h2 style={stepHeading}>That’s it</h2>
              <p style={stepBody}>
                The next visitor confirms the install. No verification button to click — Horace will spot the first ping and the agent will see it confirmed in their dashboard.
              </p>
            </div>
          </li>
        </ol>

        <p style={{
          marginTop: 56,
          fontSize: 12,
          color: 'var(--color-stone-aa)',
          letterSpacing: '0.04em',
        }}>
          Questions? Reply to the email that pointed you here, or contact{' '}
          <a href="mailto:hello@gohorace.com" style={{ color: 'var(--color-terracotta-text)', textDecoration: 'underline' }}>
            hello@gohorace.com
          </a>.
        </p>
      </div>
    </main>
  )
}

const inlineCode: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.92em',
  background: 'rgba(140,123,107,0.12)',
  padding: '1px 6px',
  borderRadius: 4,
}

const stepBlock: React.CSSProperties = {
  display: 'flex',
  gap: 18,
  alignItems: 'flex-start',
}

const stepNum: React.CSSProperties = {
  flexShrink: 0,
  width: 32,
  height: 32,
  borderRadius: '50%',
  background: 'var(--color-cream)',
  border: '1px solid var(--border-subtle)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--color-ink)',
}

const stepHeading: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 20,
  fontWeight: 600,
  margin: 0,
  letterSpacing: '-0.015em',
}

const stepBody: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.65,
  color: 'var(--color-stone-aa)',
  margin: '6px 0 0',
}
