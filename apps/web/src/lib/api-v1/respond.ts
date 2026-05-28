/**
 * HOR-321 · Public API v1 — error shape, status map, response helpers.
 *
 * Every v1 response goes through here so the contract stays consistent:
 *
 *   error    →  { "error": { "type", "message", "field"? } }
 *   single   →  the resource object
 *   list     →  { "data": [...], "next_cursor": string | null }
 *
 * Status codes follow the spec's table. Rate-limit headers are layered in by
 * the limiter in Phase 2 (HOR-322); helpers here already accept extra headers.
 */
import { NextResponse } from 'next/server'

export type ApiErrorType =
  | 'authentication_error'
  | 'permission_error'
  | 'validation_error'
  | 'not_found'
  | 'conflict'
  | 'rate_limit_error'
  | 'server_error'

const STATUS_BY_TYPE: Record<ApiErrorType, number> = {
  authentication_error: 401,
  permission_error: 403,
  validation_error: 400,
  not_found: 404,
  conflict: 409,
  rate_limit_error: 429,
  server_error: 500,
}

type RespOpts = { status?: number; headers?: Record<string, string> }

/** A throwable error that carries its public type/field. Handlers can `throw`
 *  it anywhere; `withApiV1` converts it to the canonical JSON shape. */
export class ApiError extends Error {
  readonly type: ApiErrorType
  readonly field?: string
  readonly status: number
  readonly headers?: Record<string, string>

  constructor(
    type: ApiErrorType,
    message: string,
    opts: { field?: string; status?: number; headers?: Record<string, string> } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.type = type
    this.field = opts.field
    this.status = opts.status ?? STATUS_BY_TYPE[type]
    this.headers = opts.headers
  }
}

export function apiError(
  type: ApiErrorType,
  message: string,
  opts: { field?: string; status?: number; headers?: Record<string, string> } = {},
): NextResponse {
  const body: { error: { type: ApiErrorType; message: string; field?: string } } = {
    error: { type, message },
  }
  if (opts.field) body.error.field = opts.field
  return NextResponse.json(body, {
    status: opts.status ?? STATUS_BY_TYPE[type],
    headers: opts.headers,
  })
}

/** Single-resource success (defaults to 200; pass status 201 on create). */
export function apiData(data: unknown, opts: RespOpts = {}): NextResponse {
  return NextResponse.json(data, { status: opts.status ?? 200, headers: opts.headers })
}

/** List success with cursor envelope. */
export function apiList(
  data: unknown[],
  nextCursor: string | null,
  opts: RespOpts = {},
): NextResponse {
  return NextResponse.json(
    { data, next_cursor: nextCursor },
    { status: opts.status ?? 200, headers: opts.headers },
  )
}

/** Convert any thrown value into the canonical error response. Known
 *  ApiErrors keep their type/field; anything else becomes a 500 server_error
 *  without leaking internals. */
export function toErrorResponse(e: unknown): NextResponse {
  if (e instanceof ApiError) {
    return apiError(e.type, e.message, { field: e.field, status: e.status, headers: e.headers })
  }
  return apiError('server_error', 'Something went wrong on our end.')
}
