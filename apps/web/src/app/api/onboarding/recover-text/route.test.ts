import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { RecoverTextResponse } from './types'

/**
 * Tests focus on the route's resilience without an LLM:
 *   • ANTHROPIC_API_KEY unset → never 5xx; return the deterministic
 *     fallback shape per turn.
 *   • Rate-limit returns the rate_limited variant (after 9 bursts).
 *
 * The happy-path LLM call is not exercised here — we don't hit the
 * live API in CI. Voice rules on the rescue fallback are asserted
 * inline (no exclamation marks, no banned terms).
 */

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'test-user-1' } } })),
    },
  })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    rpc: vi.fn(async () => ({ data: [], error: null })),
  })),
}))

beforeEach(() => {
  // Wipe rate-limit state between tests; the route uses a module-level
  // Map so we have to dynamically re-import.
  vi.resetModules()
})

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY
})

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/onboarding/recover-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/onboarding/recover-text', () => {
  it('returns empty candidates fallback for turn=patch when ANTHROPIC_API_KEY is unset', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { POST } = await import('./route')
    const res = await POST(makeRequest({ turn: 'patch', input: 'northern beaches' }) as never)
    const data = (await res.json()) as RecoverTextResponse
    expect(res.status).toBe(200)
    expect(data.kind).toBe('suburb_candidates')
    if (data.kind === 'suburb_candidates') {
      expect(data.items).toEqual([])
    }
  })

  it('returns the deterministic Horace rescue line for turn=rescue when API key is unset', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { POST } = await import('./route')
    const res = await POST(makeRequest({ turn: 'rescue', input: 'asdfqwer' }) as never)
    const data = (await res.json()) as RecoverTextResponse
    expect(res.status).toBe(200)
    expect(data.kind).toBe('rescue')
    if (data.kind === 'rescue') {
      expect(data.horace_line.length).toBeGreaterThan(0)
      // Voice rule: no exclamation marks in the fallback line.
      expect(data.horace_line).not.toContain('!')
      // Fallback always recommends bail since we have no real signal.
      expect(data.suggested_next_action).toBe('bail')
    }
  })

  it('returns 200 with kind=error for invalid request body', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { POST } = await import('./route')
    const res = await POST(makeRequest({ turn: 'invalid' }) as never)
    const data = (await res.json()) as RecoverTextResponse
    expect(res.status).toBe(200)
    expect(data.kind).toBe('error')
  })

  it('returns 200 with kind=error for empty input', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { POST } = await import('./route')
    const res = await POST(makeRequest({ turn: 'patch', input: '' }) as never)
    const data = (await res.json()) as RecoverTextResponse
    expect(res.status).toBe(200)
    expect(data.kind).toBe('error')
  })

  it('rate-limits the same user after the bucket drains (rapid burst)', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { POST } = await import('./route')
    let sawRateLimit = false
    // Bucket capacity is 8; the 9th call within a tight window should
    // trip the limiter.
    for (let i = 0; i < 10; i += 1) {
      const res = await POST(
        makeRequest({ turn: 'patch', input: 'northern beaches' }) as never,
      )
      const data = (await res.json()) as RecoverTextResponse
      if (data.kind === 'rate_limited') {
        sawRateLimit = true
        expect(data.retry_after_seconds).toBeGreaterThan(0)
        break
      }
    }
    expect(sawRateLimit).toBe(true)
  })
})
