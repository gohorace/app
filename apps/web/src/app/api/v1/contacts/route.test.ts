import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Shared mock state, hoisted so the vi.mock factories can reference it.
const h = vi.hoisted(() => ({
  resolve: {
    data: [{ workspace_id: 'ws-1' }] as Array<{ workspace_id: string }> | null,
    error: null as unknown,
  },
  dbResult: { data: [] as unknown[], error: null as unknown },
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: vi.fn(async () => h.resolve) }),
}))

vi.mock('@/lib/api-v1/db', () => ({
  createApiV1Db: () => ({
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

  it('401s when the token does not resolve', async () => {
    h.resolve = { data: [], error: null }
    const res = await GET(
      makeReq('https://api.test/api/v1/contacts', { authorization: 'Bearer hra_live_bogus' }),
    )
    expect(res.status).toBe(401)
  })

  it('returns the list envelope, projects source, and scopes to the resolved workspace', async () => {
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

    // Isolation: the query is scoped to the workspace the key resolved to, and
    // hides soft-deleted rows.
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
