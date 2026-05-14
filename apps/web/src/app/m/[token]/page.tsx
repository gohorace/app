/**
 * HOR-160 — GET /m/[token].
 *
 * The phone-facing entry point of the pairing flow. Public route
 * (allowlisted in middleware). On a valid, un-expired, un-consumed
 * token we mint a Supabase magic link bound to the agent's user
 * and redirect the phone to it. The magic link redeems via the
 * existing /auth/callback handler (which honours `redirectTo`) and
 * lands the phone at /m/[token]/install with a real Supabase
 * session.
 *
 * Three terminal-error states get a branded fallback page rather
 * than a redirect:
 *   • token not found → "this link's expired" copy
 *   • token expired   → "this link's expired" copy
 *   • token consumed  → "you're already paired" copy
 *
 * Anything weirder (missing user record, generateLink failure) bails
 * to the same expired copy with a server-logged error — we don't
 * want to leak provider details to the phone.
 */

import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashPairingToken, looksLikePairingToken } from '@/lib/pairing/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Props {
  params: { token: string }
}

type State = 'expired' | 'consumed' | 'error'

export default async function MobilePairingRedirect({ params }: Props) {
  const { token } = params

  // Early-out on obvious junk before hitting the DB.
  if (!looksLikePairingToken(token)) {
    return <FallbackPage state="expired" />
  }

  const admin = createAdminClient()
  const tokenHash = hashPairingToken(token)

  const { data: row } = await admin
    .from('pairing_tokens')
    .select('id, agent_id, expires_at, consumed_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (!row) {
    return <FallbackPage state="expired" />
  }
  if (row.consumed_at) {
    return <FallbackPage state="consumed" />
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return <FallbackPage state="expired" />
  }

  // Look up the agent's auth user email — magic link is bound to it.
  const { data: agent } = await admin
    .from('agents')
    .select('user_id')
    .eq('id', row.agent_id)
    .maybeSingle()

  if (!agent) {
    console.error('[/m/token] orphan pairing_token row, no agent:', row.id)
    return <FallbackPage state="error" />
  }

  const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(agent.user_id)
  const email = userRes?.user?.email
  if (userErr || !email) {
    console.error('[/m/token] getUserById error:', userErr ?? 'no email')
    return <FallbackPage state="error" />
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const callbackTarget = `${appUrl}/auth/callback?redirectTo=${encodeURIComponent(`/m/${token}/install`)}`

  const { data: linkRes, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: callbackTarget },
  })

  const actionLink = linkRes?.properties?.action_link
  if (linkErr || !actionLink) {
    console.error('[/m/token] generateLink error:', linkErr ?? 'no action_link')
    return <FallbackPage state="error" />
  }

  redirect(actionLink)
}

// ────────────────────────────────────────────────────────────────────
// Fallback page — rendered when the token is unusable.
//
// Branded but lightweight; no client JS. Copy matches the handoff
// doc and the existing voice standards (first-person Horace, no
// emojis, no exclamations). Inline styles match /install/[siteId].
// ────────────────────────────────────────────────────────────────────

const COPY: Record<State, { title: string; body: string }> = {
  expired: {
    title: "This link's expired.",
    body: "Head back to your desktop and grab a new one — we'll be quick.",
  },
  consumed: {
    title: "Already paired.",
    body: "Looks like this is already set up. You're good to go.",
  },
  error: {
    title: "Something went wrong.",
    body: "Head back to your desktop and try again. If it keeps happening, ping us at hello@gohorace.com.",
  },
}

function FallbackPage({ state }: { state: State }) {
  const { title, body } = COPY[state]
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--color-parchment)',
        color: 'var(--color-ink)',
        padding: '64px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
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
            fontSize: 32,
            lineHeight: 1.15,
            margin: '0 0 16px',
            color: 'var(--color-ink)',
          }}
        >
          {title}
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.5, color: 'var(--color-stone)', margin: 0 }}>
          {body}
        </p>
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
