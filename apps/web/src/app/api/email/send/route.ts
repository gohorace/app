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
import { getSeatPermissions } from '@/lib/seats/permissions'
import { logAudit, actingAs, AuditAction } from '@/lib/audit/log'
import type { SupabaseClient } from '@supabase/supabase-js'
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
  /** The caller's OWN agent (the actor). For a Support seat, the support seat. */
  agentId: string
  workspaceId: string
  source: EmailSendSource
  /** Acting user id (UI/cookie path). Null on the MCP/Bearer path. */
  userId: string | null
  /** Agent ids the caller may send on behalf of (own, or a Support seat's links). */
  allowedAgentIds: string[]
}

/**
 * HOR-378: resolve the agent the email is sent AS — the contact's owner, but only
 * if it's within the caller's allowed scope. Returns null when the contact is
 * missing or out of scope, so the caller falls back to its own agent and the
 * orchestrator's ownership check produces the existing error.
 */
async function resolveSendingAgent(
  admin: SupabaseClient,
  contactId: string,
  allowedAgentIds: string[],
): Promise<string | null> {
  if (!contactId) return null
  const { data } = await admin
    .from('contacts')
    .select('agent_id, owner_agent_id')
    .eq('id', contactId)
    .maybeSingle()
  if (!data) return null
  const owner =
    ((data as { owner_agent_id: string | null }).owner_agent_id ??
      (data as { agent_id: string | null }).agent_id) ?? null
  return owner && allowedAgentIds.includes(owner) ? owner : null
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

  // HOR-378: the email is sent AS the contact's owner (the vendor-facing agent).
  // For a normal agent that's themselves; for a Support seat it's the linked
  // agent. Falls back to the caller's own agent when out of scope, so the
  // orchestrator's ownership check produces the existing error.
  const sendingAgentId =
    (await resolveSendingAgent(admin, payload.contact_id, auth.allowedAgentIds)) ??
    auth.agentId

  const sendCtx = {
    admin,
    agentId: sendingAgentId,
    workspaceId: auth.workspaceId,
    actingUserId: auth.userId,
    source,
  }
  // Two-identity audit: actor = the caller's own agent; acting_as = the sending
  // agent when they differ (a Support seat on behalf of a linked agent).
  const identity = actingAs(auth.agentId, sendingAgentId)
  try {
    // Scheduled send (HOR-357) — park the row; the cron worker fires it.
    if (payload.scheduled_at) {
      const scheduled = await scheduleTrackedEmail(sendCtx, payload, payload.scheduled_at)
      await logAudit(admin, {
        workspaceId: auth.workspaceId,
        actorUserId: auth.userId,
        actorAgentId: auth.agentId,
        actingAsAgentId: identity.actingAsAgentId,
        action: AuditAction.EmailSchedule,
        resourceType: 'email',
        resourceId: scheduled.email_send_id,
        scope: identity.scope,
        metadata: { source, contact_id: payload.contact_id, scheduled_at: payload.scheduled_at },
      })
      return NextResponse.json(scheduled, { status: 200 })
    }
    const result = await sendTrackedEmail(sendCtx, payload)
    await logAudit(admin, {
      workspaceId: auth.workspaceId,
      actorUserId: auth.userId,
      actorAgentId: auth.agentId,
      actingAsAgentId: identity.actingAsAgentId,
      action: AuditAction.EmailSend,
      resourceType: 'email',
      resourceId: result.email_send_id,
      scope: identity.scope,
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
    // The MCP token authenticates a single agent; it sends only as itself.
    return {
      agentId: mcp.agentId,
      workspaceId: mcp.workspaceId,
      source: 'mcp',
      userId: null,
      allowedAgentIds: [mcp.agentId],
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

  // HOR-378: a Support seat may send on behalf of its linked agent(s).
  const seats = await getSeatPermissions(admin, user.id)
  const allowedAgentIds =
    seats.allowedAgentIds.length > 0 ? seats.allowedAgentIds : [agent.id]

  return {
    agentId: agent.id,
    workspaceId: agent.workspace_id,
    source: 'ui',
    userId: user.id,
    allowedAgentIds,
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
