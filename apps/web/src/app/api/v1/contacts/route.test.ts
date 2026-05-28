import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Shared mock state, hoisted so the vi.mock factory can reference it.
const h = vi.hoisted(() => ({
  resolve: {
    data: [{ workspace_id: 'ws-1' }] as Array<{ workspace_id: string }> | null,
    error: null as unknown,
  },
  rate: {
    data: [
      { allowed: true, limit_per_min: 600, remaining: 599, reset_epoch: 1900000000, retry_after: 0 },
    ] as unknown[],
    error: null as unknown,
  },
  dbResult: { data: [] as unknown[], error: null as unknown },
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
}))

vi.mock('@/lib/api-v1/db', () => ({
  createApiV1Db: () => ({
    rpc: (name: string) =>
      name === 'resolve_api_v1_token' ? Promise.resolve(h.resolve) : Promise.resolve(h.rate),
    from(table: string) {
      const TERMINALS = new Set(['limit', 'maybeSingle', 'single'])
      const proxy: unknown = new Proxy(
        {},
        {
          get:
            (_t, prop: string) =>
            (...args: unknown[]) => {
              h.calls.push({ table, method: prop, args })
              return TERMINALS.has(prop) ? Promise.resolve(h.dbResult) : proxy
            },
        },
      )
      return proxy
    },
  }),
}))

import { GET } from './route'

beforeEach(() => {
  h.resolve = { data: [{ workspace_id: 'ws-1' }], error: null }
  h.rate = {
    data: [
      { allowed: true, limit_per_min: 600, remaining: 599, reset_epoch: 1900000000, retry_after: 0 },
    ],
    error: null,
  }
  h.dbResult = { data: [], error: null }
  h.calls.length = 0
})

function makeReq(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers })
}

describe('GET /v1/contacts', () => {
  it('401s without an API key', async () => {
    const res = await GET(makeReq('https://api.test/api/v1/contacts'))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.type).toBe('authentication_error')
  })

  it('401s when the token does not resolve (e.g. an MCP hor_ token)', async () => {
    h.resolve = { data: [], error: null }
    const res = await GET(
      makeReq('https://api.test/api/v1/contacts', { authorization: 'Bearer hor_mcp_token' }),
    )
    expect(res.status).toBe(401)
  })

  it('returns the list envelope, projects source, scopes to the workspace, sets rate headers', async () => {
    h.dbResult = {
      data: [
        {
          id: '11111111-2222-4333-8444-555566667777',
          email: 'Sarah.Chen@Example.com',
          phone: null,
          first_name: 'Sarah',
          last_name: 'Chen',
          source: 'website',
          ingestion_method: 'embed_capture',
          external_ids: { rex: 'rex_99' },
          created_at: 'c',
          updated_at: 'u',
        },
      ],
      error: null,
    }

    const res = await GET(
      makeReq('https://api.test/api/v1/contacts', { authorization: 'Bearer hra_live_ok' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('next_cursor', null)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id.startsWith('con_')).toBe(true)
    expect(body.data[0].email).toBe('sarah.chen@example.com')
    expect(body.data[0].source).toBe('doorstep_buyer_enquiry')

    // Rate-limit headers on success.
    expect(res.headers.get('X-RateLimit-Limit')).toBe('600')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('599')

    // Isolation: scoped to the resolved workspace, hides soft-deleted rows.
    const contactCalls = h.calls.filter((c) => c.table === 'contacts')
    expect(
      contactCalls.some(
        (c) => c.method === 'eq' && c.args[0] === 'workspace_id' && c.args[1] === 'ws-1',
      ),
    ).toBe(true)
    expect(
      contactCalls.some(
        (c) => c.method === 'is' && c.args[0] === 'deleted_at' && c.args[1] === null,
      ),
    ).toBe(true)
  })

  it('429s with Retry-After when the rate limit is exceeded', async () => {
    h.rate = {
      data: [
        { allowed: false, limit_per_min: 600, remaining: 0, reset_epoch: 1900000000, retry_after: 7 },
      ],
      error: null,
    }
    const res = await GET(
      makeReq('https://api.test/api/v1/contacts', { authorization: 'Bearer hra_live_ok' }),
    )
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error.type).toBe('rate_limit_error')
    expect(res.headers.get('Retry-After')).toBe('7')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0')
  })

  it('rejects an out-of-range limit with 400', async () => {
    const res = await GET(
      makeReq('https://api.test/api/v1/contacts?limit=0', { authorization: 'Bearer hra_live_ok' }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.type).toBe('validation_error')
    expect(body.error.field).toBe('limit')
  })
})
