/**
 * HOR-160 — GET /m/[token]/install.
 *
 * The phone-side install shell, rendered after the phone has
 * redeemed the magic link via /auth/callback. Auth-protected by
 * middleware — by the time we render here the phone has a real
 * Supabase session for the agent's user.
 *
 * Responsibilities for this slice (HOR-160):
 *   • Server-side: verify the token row belongs to the calling
 *     user's agent, is un-expired and un-consumed.
 *   • Server-side: render the UA-appropriate install component
 *     slot (iOS guide / Android prompt / unsupported) — these are
 *     currently placeholders; real components land in HOR-163 / .5b.
 *   • Client-side (via <PairingBootstrap>): write the
 *     `pairing_active=<token>` cookie + `localStorage.pairingToken`
 *     so the dashboard standalone overlay (HOR-165) can detect an
 *     in-flight pairing when the iOS PWA launches from the
 *     home-screen icon.
 *
 * Cookie/localStorage are intentionally readable by the client —
 * `HttpOnly=false` is required so the dashboard overlay can detect
 * the cookie from the client. Server-side verification on each use
 * means we never trust the cookie alone for state.
 */

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashPairingToken, looksLikePairingToken } from '@/lib/pairing/tokens'
import { deviceLabelFromUA } from '@/lib/pairing/device-label'
import { headers } from 'next/headers'
import { PairingBootstrap } from './pairing-bootstrap'
import { IOSInstallGuide } from '@/components/mobile/ios-install-guide'
import { AndroidInstallPrompt } from '@/components/mobile/android-install-prompt'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Props {
  params: { token: string }
}

export default async function MobilePairingInstall({ params }: Props) {
  const { token } = params

  // Defensive: middleware should have rejected an obviously-bad
  // token, but the auth pipeline runs ahead of any shape check.
  if (!looksLikePairingToken(token)) {
    redirect(`/m/${token}`)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    // Middleware should have caught this; treat as expiry.
    redirect(`/m/${token}`)
  }

  const admin = createAdminClient()
  const tokenHash = hashPairingToken(token)

  const { data: row } = await admin
    .from('pairing_tokens')
    .select('id, agent_id, expires_at, consumed_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (!row) redirect(`/m/${token}`)
  if (row.consumed_at) redirect(`/m/${token}`)
  if (new Date(row.expires_at).getTime() <= Date.now()) redirect(`/m/${token}`)

  // Confirm the row belongs to this user's agent. Same magic link
  // is bound to the agent's email, so a stranger redeeming a token
  // they shouldn't have access to would fail at the auth step — but
  // we belt-and-brace the agent-id check here anyway.
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent || agent.id !== row.agent_id) {
    console.warn('[/m/token/install] token/agent mismatch:', { user: user.id, row: row.id })
    redirect(`/m/${token}`)
  }

  const headerList = await headers()
  const ua = headerList.get('user-agent') ?? ''
  const label = deviceLabelFromUA(ua)
  const platform: 'ios' | 'android' | 'other' =
    label === 'iPhone' || label === 'iPad'
      ? 'ios'
      : label === 'Android phone' || label === 'Android tablet'
        ? 'android'
        : 'other'

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--color-parchment)',
        color: 'var(--color-ink)',
        padding: '48px 24px',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
      }}
    >
      <PairingBootstrap token={token} />

      <div style={{ maxWidth: 480, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: 'var(--color-terracotta)',
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>Horace</span>
        </div>

        <h1
          style={{
            fontFamily: 'var(--font-serif, Georgia, serif)',
            fontSize: 28,
            lineHeight: 1.2,
            margin: '0 0 12px',
          }}
        >
          You&rsquo;re in.
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.5, color: 'var(--color-stone)', margin: '0 0 32px' }}>
          Two quick steps and Horace lives in your pocket.
        </p>

        {/* Platform-specific slot — real components land in HOR-163 (iOS) and HOR-164 (Android). */}
        <PlatformSlot platform={platform} token={token} />

        <p
          style={{
            marginTop: 48,
            fontSize: 13,
            color: 'var(--color-stone)',
            opacity: 0.7,
          }}
        >
          Seize the moment — Horace
        </p>
      </div>
    </main>
  )
}

function PlatformSlot({
  platform,
  token,
}: {
  platform: 'ios' | 'android' | 'other'
  token: string
}) {
  if (platform === 'ios') {
    return <IOSInstallGuide />
  }

  if (platform === 'android') {
    return <AndroidInstallPrompt token={token} />
  }

  // Anything else — desktop browsers visiting the URL out of curiosity,
  // in-app webviews, Firefox iOS, etc. We don't try to push them
  // through the flow; the copy points them at a supported browser.
  return (
    <div
      style={{
        padding: 20,
        border: '1px solid var(--color-border, #E4DCDA)',
        borderRadius: 12,
        background: 'var(--color-cream, #FAF7F2)',
      }}
    >
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
        Push isn&rsquo;t supported in this browser. Open this link in Safari
        or Chrome on your phone to continue.
      </p>
    </div>
  )
}
