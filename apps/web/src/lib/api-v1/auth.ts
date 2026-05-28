/**
 * HOR-321/322 · Public API v1 — authentication, rate limiting, handler wrapper.
 *
 * A request carries `Authorization: Bearer hra_live_…`. We resolve it to an
 * agency (workspace) via `resolve_api_v1_token`, which gates on `kind=api_v1`
 * (so MCP `hor_` tokens never authenticate here) and stamps last_used_at +
 * last_used_ip. v1 keys are agency-scoped: a key reads the whole workspace, so
 * we keep only `workspaceId`.
 *
 * Every authenticated request is metered by `consume_rate_token` (600/min +
 * 10/s burst per agency). Successful responses carry the X-RateLimit-* headers;
 * a breach returns 429 with Retry-After. Both new RPCs go through the untyped
 * data client (they're not in the generated types yet).
 */
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { extractBearer, hashToken } from '@/lib/mcp/auth'
import { createApiV1Db } from './db'
import { ApiError, apiError, toErrorResponse } from './respond'

export interface ApiV1Context {
  req: NextRequest
  workspaceId: string
  db: SupabaseClient
  params: Record<string, string | undefined>
}

type Handler = (ctx: ApiV1Context) => Promise<NextResponse> | NextResponse

interface RateVerdict {
  allowed: boolean
  limit_per_min: number
  remaining: number
  reset_epoch: number
  retry_after: number
}

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]?.trim() || null
  return req.headers.get('x-real-ip') || null
}

/** Resolve the bearer token to a workspace id (kind=api_v1 only), or null. */
export async function resolveWorkspace(
  req: NextRequest,
  db: SupabaseClient,
): Promise<string | null> {
  const token = extractBearer(req.headers)
  if (!token) return null

  const { data, error } = await db.rpc('resolve_api_v1_token', {
    p_token_hash: hashToken(token),
    p_source_ip: clientIp(req),
  })
  if (error || !data || data.length === 0) return null
  return data[0].workspace_id as string
}

/** Meter the request. Fails open (allow) if the limiter itself errors, so a
 *  limiter hiccup never takes the API down. */
async function consumeRate(db: SupabaseClient, workspaceId: string): Promise<RateVerdict> {
  const { data, error } = await db.rpc('consume_rate_token', { p_workspace_id: workspaceId })
  const row = Array.isArray(data) ? data[0] : data
  if (error || !row) {
    const reset = Math.floor(Date.now() / 1000 / 60) * 60 + 60
    return { allowed: true, limit_per_min: 600, remaining: 600, reset_epoch: reset, retry_after: 0 }
  }
  return row as RateVerdict
}

function rateLimitHeaders(v: RateVerdict): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(v.limit_per_min),
    'X-RateLimit-Remaining': String(v.remaining),
    'X-RateLimit-Reset': String(v.reset_epoch),
  }
}

/**
 * Wrap a v1 route handler: enforce auth + rate limit, build the data client +
 * params, and funnel thrown errors into the canonical JSON error shape. Works
 * for both static (`/contacts`) and dynamic (`/contacts/[id]`) routes.
 */
export function withApiV1(handler: Handler) {
  return async (
    req: NextRequest,
    route?: { params?: Record<string, string> },
  ): Promise<NextResponse> => {
    try {
      const db = createApiV1Db()

      const workspaceId = await resolveWorkspace(req, db)
      if (!workspaceId) {
        throw new ApiError('authentication_error', 'Missing or invalid API key.')
      }

      const rate = await consumeRate(db, workspaceId)
      const headers = rateLimitHeaders(rate)
      if (!rate.allowed) {
        return apiError(
          'rate_limit_error',
          'Rate limit reached — ease off and try again shortly.',
          {
            headers: { ...headers, 'Retry-After': String(rate.retry_after) },
          },
        )
      }

      const res = await handler({ req, workspaceId, db, params: route?.params ?? {} })
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
      return res
    } catch (e) {
      return toErrorResponse(e)
    }
  }
}
