/**
 * HOR-321 · Public API v1 — cursor pagination.
 *
 * Keyset pagination over `(sortColumn ASC, id ASC)`. The cursor is an opaque
 * base64url blob carrying the last row's sort value + id, so paging is stable
 * even as rows are inserted. `id` (a UUID) is the tiebreak for equal sort
 * values.
 *
 * Routes use it as:
 *   const limit = parseLimit(searchParams.get('limit'))
 *   let q = db.from(t).select(...).eq('workspace_id', ws)
 *   q = q.order(sortCol, { ascending: true }).order('id', { ascending: true })
 *   const orExpr = cursorOrExpr(sortCol, searchParams.get('cursor'))
 *   if (orExpr) q = q.or(orExpr)
 *   const { data } = await q.limit(limit + 1)        // over-fetch by 1
 *   const { rows, nextCursor } = sliceCursor(data, limit, sortCol)
 */
import { ApiError } from './respond'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200

export function parseLimit(raw: string | null): number {
  if (raw == null || raw === '') return DEFAULT_LIMIT
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    throw new ApiError('validation_error', 'limit must be a positive integer.', { field: 'limit' })
  }
  return Math.min(n, MAX_LIMIT)
}

/** Validate an ISO-8601 `updated_since`-style param. Returns the raw string
 *  (PostgREST compares it as timestamptz) or undefined when absent. */
export function parseTimestamp(raw: string | null, field: string): string | undefined {
  if (raw == null || raw === '') return undefined
  if (Number.isNaN(Date.parse(raw))) {
    throw new ApiError('validation_error', `${field} must be an ISO-8601 timestamp.`, { field })
  }
  return raw
}

/** Validate an enum query param against an allow-list. Undefined when absent. */
export function parseEnum<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  field: string,
): T | undefined {
  if (raw == null || raw === '') return undefined
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new ApiError('validation_error', `${field} must be one of: ${allowed.join(', ')}.`, {
      field,
    })
  }
  return raw as T
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url')
}
function b64urlDecode(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8')
}

export function encodeCursor(sortValue: string, id: string): string {
  return b64urlEncode(JSON.stringify({ t: sortValue, id }))
}

export function decodeCursor(cursor: string): { t: string; id: string } | null {
  try {
    const parsed = JSON.parse(b64urlDecode(cursor)) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { t?: unknown }).t === 'string' &&
      typeof (parsed as { id?: unknown }).id === 'string'
    ) {
      return parsed as { t: string; id: string }
    }
    return null
  } catch {
    return null
  }
}

/** Build the PostgREST `.or()` expression that resumes after a cursor:
 *  rows strictly after (sortValue, id). Returns null when there's no cursor.
 *  Throws on a malformed cursor so the caller surfaces a 400. */
export function cursorOrExpr(sortColumn: string, cursor: string | null): string | null {
  if (!cursor) return null
  const c = decodeCursor(cursor)
  if (!c) throw new ApiError('validation_error', 'Invalid cursor.', { field: 'cursor' })
  return `${sortColumn}.gt.${c.t},and(${sortColumn}.eq.${c.t},id.gt.${c.id})`
}

/** Trim the over-fetched row and derive the next cursor. `rows` is the raw DB
 *  result (length up to limit+1). The returned rows are the page; nextCursor is
 *  null when the page wasn't full. */
export function sliceCursor<T extends { id: string }>(
  rows: T[] | null,
  limit: number,
  sortColumn: string,
): { rows: T[]; nextCursor: string | null } {
  const all = rows ?? []
  const hasMore = all.length > limit
  const page = hasMore ? all.slice(0, limit) : all
  const last = page[page.length - 1]
  const sortValue = last ? (last as Record<string, unknown>)[sortColumn] : undefined
  const nextCursor = hasMore && last ? encodeCursor(String(sortValue), last.id) : null
  return { rows: page, nextCursor }
}
