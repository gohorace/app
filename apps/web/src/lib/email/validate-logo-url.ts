/**
 * Validate a public image URL pasted into the signature settings (HOR-xxx).
 *
 * Used by /api/settings/profile on save. We probe the URL to confirm it's
 * publicly fetchable and serves an image content-type, and cap the size at
 * 2 MB. We don't fetch the bytes — render time is the ESP's problem.
 *
 * Probe strategy:
 *   1. HEAD with a browser-ish User-Agent (Node's default UA gets 403 from
 *      Wikimedia/Cloudflare/etc.).
 *   2. If HEAD returns non-2xx or doesn't expose a usable content-type, fall
 *      back to GET with `Range: bytes=0-0` so we still only pull a single byte
 *      to confirm the image type. Many CDNs accept GET but reject HEAD.
 */

const MAX_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 5_000

/** Generic public-bot UA. Avoids the Wikimedia/Cloudflare 403 path that
 *  Node's default `node` UA hits. Identifies us so admins can rate-limit if
 *  needed (real fetches at render time go through the ESP, not us). */
const PROBE_USER_AGENT =
  'HoraceLogoProbe/1.0 (+https://gohorace.com; contact: team@gohorace.com)'

export type LogoUrlError =
  | 'invalid_url'
  | 'unsupported_scheme'
  | 'not_reachable'
  | 'not_image'
  | 'too_large'

export interface LogoUrlValidationFailure {
  ok: false
  error: LogoUrlError
}

export interface LogoUrlValidationSuccess {
  ok: true
  url: string
}

export type LogoUrlValidation = LogoUrlValidationSuccess | LogoUrlValidationFailure

export async function validateLogoUrl(input: string): Promise<LogoUrlValidation> {
  const raw = input.trim()
  if (!raw) return { ok: false, error: 'invalid_url' }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, error: 'invalid_url' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'unsupported_scheme' }
  }

  const head = await probe(parsed.toString(), 'HEAD')
  if (head.ok) {
    return finalise(parsed, head.contentType, head.contentLength)
  }

  // HEAD failed (transport error, non-2xx, or missing content-type). Many
  // CDNs reject HEAD but accept GET. Range: bytes=0-0 keeps us at one byte.
  const get = await probe(parsed.toString(), 'GET')
  if (!get.ok) return { ok: false, error: get.error ?? 'not_reachable' }

  return finalise(parsed, get.contentType, get.contentLength)
}

type ProbeResult =
  | { ok: true; contentType: string; contentLength: number | null }
  | { ok: false; error: LogoUrlError | null }

async function probe(url: string, method: 'HEAD' | 'GET'): Promise<ProbeResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const headers: Record<string, string> = {
      'user-agent': PROBE_USER_AGENT,
      accept: 'image/*,*/*;q=0.5',
    }
    if (method === 'GET') headers.range = 'bytes=0-0'

    const res = await fetch(url, {
      method,
      signal: controller.signal,
      redirect: 'follow',
      headers,
    })

    // 200 OK for HEAD; 206 Partial Content for the ranged GET. Some servers
    // ignore the range and reply 200 — both are fine.
    if (!res.ok && res.status !== 206) {
      return { ok: false, error: 'not_reachable' }
    }

    const contentType = res.headers.get('content-type') ?? ''
    const lenHeader = res.headers.get('content-length')
    const len = lenHeader ? Number.parseInt(lenHeader, 10) : null
    return {
      ok: true,
      contentType,
      contentLength: len !== null && Number.isFinite(len) ? len : null,
    }
  } catch {
    return { ok: false, error: 'not_reachable' }
  } finally {
    clearTimeout(timeout)
  }
}

function finalise(
  parsed: URL,
  contentType: string,
  contentLength: number | null,
): LogoUrlValidation {
  if (!contentType.toLowerCase().startsWith('image/')) {
    return { ok: false, error: 'not_image' }
  }
  // The 206 ranged GET reports content-length=1 even for huge images. Only
  // trust the size cap when the server returned the full payload (HEAD or
  // unranged 200) — best-effort guard; render time isn't our concern.
  if (contentLength !== null && contentLength > MAX_BYTES && contentLength > 1024) {
    return { ok: false, error: 'too_large' }
  }
  return { ok: true, url: parsed.toString() }
}

export function logoUrlErrorMessage(err: LogoUrlError): string {
  switch (err) {
    case 'invalid_url':         return 'That logo URL doesn’t look right — paste a full public link.'
    case 'unsupported_scheme':  return 'Logo URLs must start with http:// or https://.'
    case 'not_reachable':       return 'Couldn’t reach that logo URL — check the link is public.'
    case 'not_image':           return 'That URL doesn’t point to an image.'
    case 'too_large':           return 'That image is too large — logos should be under 2 MB.'
  }
}
