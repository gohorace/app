import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hold mutable mock surfaces so each test can rewire auth + db behaviour.
const mockUser = { current: { id: 'user-1' } as { id: string } | null }
const mockAgent = { current: { id: 'agent-1', workspace_id: 'ws-1' } as { id: string; workspace_id: string } | null }
const upsert = vi.fn(
  async (_row: Record<string, unknown>, _opts: { onConflict: string }) => ({
    error: null as null | { code?: string; message?: string },
  }),
)
const del = vi.fn(async () => ({ error: null as null | { code?: string } }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: mockUser.current } })) },
  })),
}))

vi.mock('@/lib/supabase/admin', () => {
  // Chainable builder: .from(...).upsert(...) and
  // .from(...).delete().eq().eq() both end up at the resolving call.
  const eq = vi.fn(() => ({ eq: vi.fn(() => del()) }))
  return {
    createAdminClient: vi.fn(() => ({
      from: vi.fn(() => ({
        upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => upsert(row, opts),
        delete: vi.fn(() => ({ eq })),
      })),
    })),
  }
})

vi.mock('@/lib/seats/resolve-agent', () => ({
  resolvePrimaryAgent: vi.fn(async () => mockAgent.current),
}))

beforeEach(() => {
  mockUser.current = { id: 'user-1' }
  mockAgent.current = { id: 'agent-1', workspace_id: 'ws-1' }
  upsert.mockClear()
  upsert.mockResolvedValue({ error: null })
  del.mockClear()
  del.mockResolvedValue({ error: null })
})

const VALID_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function req(method: 'POST' | 'DELETE', body: unknown): Request {
  return new Request('http://localhost/api/stream/clear', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/stream/clear', () => {
  it('returns 422 when contactId is missing', async () => {
    const { POST } = await import('./route')
    const res = await POST(req('POST', {}))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'contact_id_required' })
  })

  it('returns 422 when contactId is not a UUID', async () => {
    const { POST } = await import('./route')
    const res = await POST(req('POST', { contactId: 'not-a-uuid' }))
    expect(res.status).toBe(422)
  })

  it('returns 422 on invalid JSON', async () => {
    const { POST } = await import('./route')
    const bad = new Request('http://localhost/api/stream/clear', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })
    const res = await POST(bad)
    expect(res.status).toBe(422)
  })

  it('returns 401 when unauthenticated', async () => {
    mockUser.current = null
    const { POST } = await import('./route')
    const res = await POST(req('POST', { contactId: VALID_UUID }))
    expect(res.status).toBe(401)
  })

  it('returns 401 when no workspace can be resolved', async () => {
    mockAgent.current = null
    const { POST } = await import('./route')
    const res = await POST(req('POST', { contactId: VALID_UUID }))
    expect(res.status).toBe(401)
  })

  it('writes a Stream-scoped row with expires_at=null (stub)', async () => {
    const { POST } = await import('./route')
    const res = await POST(req('POST', { contactId: VALID_UUID }))
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    const [row, opts] = upsert.mock.calls[0]
    expect(row.scope).toBe(`stream:clear:contact:${VALID_UUID}`)
    // Stub guard: NULL means "suppress indefinitely until manual un-clear".
    // A non-null expires_at here would silently rebuild snooze.
    expect(row.expires_at).toBeNull()
    expect(row.workspace_id).toBe('ws-1')
    expect(row.agent_id).toBe('agent-1')
    expect(opts.onConflict).toBe('agent_id,scope')
  })

  it('returns 503 when the dismissed_signals table is missing', async () => {
    upsert.mockResolvedValueOnce({ error: { code: '42P01' } })
    const { POST } = await import('./route')
    const res = await POST(req('POST', { contactId: VALID_UUID }))
    expect(res.status).toBe(503)
  })
})

describe('DELETE /api/stream/clear', () => {
  it('returns 422 on bad body', async () => {
    const { DELETE } = await import('./route')
    const res = await DELETE(req('DELETE', { contactId: '' }))
    expect(res.status).toBe(422)
  })

  it('returns 401 without auth', async () => {
    mockUser.current = null
    const { DELETE } = await import('./route')
    const res = await DELETE(req('DELETE', { contactId: VALID_UUID }))
    expect(res.status).toBe(401)
  })

  it('removes the cleared row', async () => {
    const { DELETE } = await import('./route')
    const res = await DELETE(req('DELETE', { contactId: VALID_UUID }))
    expect(res.status).toBe(200)
    expect(del).toHaveBeenCalledTimes(1)
  })
})
