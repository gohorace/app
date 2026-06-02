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
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'
import { authenticateRequest } from '@/lib/mcp/auth'
import { logAudit, AuditAction } from '@/lib/audit/log'
import {
  sendTrackedEmail,
  scheduleTrackedEmail,
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
  /** Acting user id (UI/cookie path). Null on the MCP/Bearer path. */
  userId: string | null
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
  const sendCtx = {
    admin,
    agentId: auth.agentId,
    workspaceId: auth.workspaceId,
    source,
  }
  try {
    // Scheduled send (HOR-357) — park the row; the cron worker fires it.
    if (payload.scheduled_at) {
      const scheduled = await scheduleTrackedEmail(sendCtx, payload, payload.scheduled_at)
      await logAudit(admin, {
        workspaceId: auth.workspaceId,
        actorUserId: auth.userId,
        actorAgentId: auth.agentId,
        // HOR-374: actor-only for now. HOR-378 (Phase 4, two-identity comms) will
        // set acting_as once the send path distinguishes a Support seat sending on
        // behalf of its linked agent.
        action: AuditAction.EmailSchedule,
        resourceType: 'email',
        resourceId: scheduled.email_send_id,
        scope: 'own',
        metadata: { source, contact_id: payload.contact_id, scheduled_at: payload.scheduled_at },
      })
      return NextResponse.json(scheduled, { status: 200 })
    }
    const result = await sendTrackedEmail(sendCtx, payload)
    await logAudit(admin, {
      workspaceId: auth.workspaceId,
      actorUserId: auth.userId,
      actorAgentId: auth.agentId,
      // HOR-374: actor-only for now; HOR-378 adds acting_as for Support sends.
      action: AuditAction.EmailSend,
      resourceType: 'email',
      resourceId: result.email_send_id,
      scope: 'own',
      metadata: { source, contact_id: payload.contact_id },
    })
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
      userId: null,
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
  const agent = await resolvePrimaryAgent(admin, user.id, { requireWorkspace: true })

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
    userId: user.id,
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
