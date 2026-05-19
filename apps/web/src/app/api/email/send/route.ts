/**
 * POST /api/email/send
 *
 * Send a tracked email through the authenticated agent's connected Gmail
 * account. Single handler shared by:
 *   - UI composer (cookie session auth)
 *   - MCP `send_tracked_email` tool (Bearer auth via lib/mcp/auth.ts)
 *
 * Request body — see EmailSendPayload in lib/email/types.ts.
 * Response — EmailSendResult on 200; EmailSendErrorBody on 4xx/5xx.
 *
 * The route is thin: it picks the auth path, resolves agent_id + workspace_id,
 * and delegates to sendTrackedEmail(). All Gmail / Vault / DB logic lives in
 * the orchestrator so the MCP path stays identical to the UI path.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authenticateRequest } from '@/lib/mcp/auth'
import {
  sendTrackedEmail,
  SendTrackedEmailError,
} from '@/lib/email/send'
import type {
  EmailSendErrorBody,
  EmailSendPayload,
  EmailSendSource,
} from '@/lib/email/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ResolvedAuth {
  agentId: string
  workspaceId: string
  source: EmailSendSource
}

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  let auth: ResolvedAuth
  try {
    auth = await resolveAuth(req)
  } catch (err) {
    if (err instanceof Response) return err
    return errorJson('Unauthorized', 'invalid_input', 401)
  }

  // ── Parse + delegate ─────────────────────────────────────────────────────
  let payload: EmailSendPayload
  try {
    payload = (await req.json()) as EmailSendPayload
  } catch {
    return errorJson('Malformed JSON', 'invalid_input', 400)
  }

  // Source priority: explicit payload override → resolved auth source.
  const source: EmailSendSource = payload.source ?? auth.source

  const admin = createAdminClient()
  try {
    const result = await sendTrackedEmail(
      {
        admin,
        agentId: auth.agentId,
        workspaceId: auth.workspaceId,
        source,
      },
      payload,
    )
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    if (err instanceof SendTrackedEmailError) {
      const body: EmailSendErrorBody = {
        error: err.message,
        code: err.code,
        detail: err.detail,
      }
      return NextResponse.json(body, { status: err.status })
    }
    console.error('[POST /api/email/send] unexpected:', err)
    return errorJson(
      'Internal error while sending email.',
      'send_failed',
      500,
    )
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function resolveAuth(req: NextRequest): Promise<ResolvedAuth> {
  // 1. Bearer token (MCP path) — checked first so an over-eager UI cookie
  //    doesn't shadow a deliberate MCP call.
  const mcp = await authenticateRequest(req)
  if (mcp) {
    return {
      agentId: mcp.agentId,
      workspaceId: mcp.workspaceId,
      source: 'mcp',
    }
  }

  // 2. Cookie session (UI path) — resolve user → owning agent + workspace.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    throw NextResponse.json(
      { error: 'Unauthorized', code: 'invalid_input' } satisfies EmailSendErrorBody,
      { status: 401 },
    )
  }

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user.id)
    .not('workspace_id', 'is', null)
    .maybeSingle()

  if (!agent || !agent.workspace_id) {
    throw NextResponse.json(
      { error: 'No workspace found', code: 'invalid_input' } satisfies EmailSendErrorBody,
      { status: 400 },
    )
  }

  return {
    agentId: agent.id,
    workspaceId: agent.workspace_id,
    source: 'ui',
  }
}

function errorJson(
  message: string,
  code: EmailSendErrorBody['code'],
  status: number,
): NextResponse {
  const body: EmailSendErrorBody = { error: message, code }
  return NextResponse.json(body, { status })
}
