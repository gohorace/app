/**
 * HOR-321 · Public API v1 — authentication + handler wrapper.
 *
 * A request carries `Authorization: Bearer hra_live_…`. We resolve it to an
 * agency (workspace) via the same `resolve_api_token` RPC the MCP connector
 * uses (which also stamps last_used_at). v1 keys are agency-scoped: a key reads
 * the whole workspace, not one agent's slice — so we keep only `workspaceId`.
 *
 * NOTE (Phase 2, HOR-322): `resolve_api_token` currently also resolves MCP
 * (`hor_`) tokens. Phase 2 adds a `kind` column and gates the v1 surface to
 * `kind = 'api_v1'` keys minted as `hra_live_…`. Until then any resolvable
 * token authenticates; this is acceptable because both are minted by an agency
 * member and v1 only widens reads within their own agency.
 */
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { extractBearer, hashToken } from '@/lib/mcp/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createApiV1Db } from './db'
import { ApiError, toErrorResponse } from './respond'

export interface ApiV1Context {
  req: NextRequest
  workspaceId: string
  db: SupabaseClient
  params: Record<string, string | undefined>
}

type Handler = (ctx: ApiV1Context) => Promise<NextResponse> | NextResponse

/** Resolve the bearer token to a workspace id, or null if missing/invalid. */
export async function resolveWorkspace(req: NextRequest): Promise<string | null> {
  const token = extractBearer(req.headers)
  if (!token) return null

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('resolve_api_token', {
    p_token_hash: hashToken(token),
  })
  if (error || !data || data.length === 0) return null
  return data[0].workspace_id
}

/**
 * Wrap a v1 route handler: enforce auth, build the data client + params, and
 * funnel every thrown ApiError (or unexpected error) into the canonical JSON
 * error shape. Works for both static (`/contacts`) and dynamic (`/contacts/[id]`)
 * routes — Next passes `{ params }` as the second arg for the latter.
 */
export function withApiV1(handler: Handler) {
  return async (
    req: NextRequest,
    route?: { params?: Record<string, string> },
  ): Promise<NextResponse> => {
    try {
      const workspaceId = await resolveWorkspace(req)
      if (!workspaceId) {
        throw new ApiError('authentication_error', 'Missing or invalid API key.')
      }
      return await handler({
        req,
        workspaceId,
        db: createApiV1Db(),
        params: route?.params ?? {},
      })
    } catch (e) {
      return toErrorResponse(e)
    }
  }
}
