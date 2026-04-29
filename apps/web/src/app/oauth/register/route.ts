import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateClientId, isValidRedirectUri, DEFAULT_SCOPE } from '@/lib/oauth/helpers'
import type { Json } from '@/types/database.types'

export const runtime = 'nodejs'

// RFC 7591 — OAuth 2.0 Dynamic Client Registration.
// Open registration: anyone can register, but the resulting client_id is
// just an identifier — it grants no access until a user authorizes a code.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonError('invalid_client_metadata', 'Body is not valid JSON', 400)
  }

  const redirectUris = Array.isArray(body.redirect_uris) ? (body.redirect_uris as unknown[]) : []
  if (redirectUris.length === 0) {
    return jsonError('invalid_redirect_uri', 'redirect_uris is required', 400)
  }
  for (const uri of redirectUris) {
    if (typeof uri !== 'string' || !isValidRedirectUri(uri)) {
      return jsonError('invalid_redirect_uri', `Invalid redirect_uri: ${String(uri)}`, 400)
    }
  }

  const clientName =
    typeof body.client_name === 'string' ? body.client_name.slice(0, 200) : null

  const clientId = generateClientId()
  const admin = createAdminClient()

  const { error } = await admin.from('oauth_clients').insert({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris as string[],
    scope: DEFAULT_SCOPE,
    metadata: { raw: body as unknown as Json },
  })

  if (error) {
    console.error('[oauth/register] insert failed', error)
    return jsonError('server_error', 'Failed to register client', 500)
  }

  return NextResponse.json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: DEFAULT_SCOPE,
      ...(clientName ? { client_name: clientName } : {}),
    },
    { status: 201 },
  )
}

function jsonError(error: string, error_description: string, status: number) {
  return NextResponse.json({ error, error_description }, { status })
}
