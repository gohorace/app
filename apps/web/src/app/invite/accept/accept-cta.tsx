/**
 * HOR-100 — Client CTA for the invite-accept page.
 *
 * Sends a magic link to the invited email via Supabase Auth. The
 * `emailRedirectTo` carries the invite id as a URL **path segment**
 * (HOR-201) so it survives the verify → redirect round-trip even when
 * a Supabase Redirect URLs allowlist or mail scanner would strip query
 * params. The path-based callback at /auth/callback/invite/[id] then
 * calls accept_workspace_invite() once the session is established.
 *
 * shouldCreateUser is true — the invited email may not exist yet.
 */

'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

interface Props {
  inviteId: string
  email: string
}

export function AcceptInviteCta({ inviteId, email }: Props) {
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setError(null)

    const supabase = createClient()
    // HOR-201: invite_id rides in the path, not the query string.
    const callback = new URL(
      `/auth/callback/invite/${encodeURIComponent(inviteId)}`,
      window.location.origin,
    )

    const { error: sendErr } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callback.toString(),
        shouldCreateUser: true,
      },
    })

    if (sendErr) {
      setError(sendErr.message)
      setLoading(false)
      return
    }

    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <div className="space-y-3 text-sm">
        <p>Check your inbox.</p>
        <p className="text-muted-foreground">
          We sent a sign-in link to <strong>{email}</strong>. Click it to accept
          the invite and land in the workspace.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Button onClick={handleClick} disabled={loading} className="w-full">
        {loading ? 'Sending link…' : `Continue as ${email}`}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
