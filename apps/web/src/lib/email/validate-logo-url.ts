/**
 * Validate a public image URL pasted into the signature settings (HOR-xxx).
 *
 * Used by /api/settings/profile on save. We HEAD the URL to confirm it's
 * publicly fetchable and serves an image content-type, and cap the size at
 * 2 MB. We don't fetch the bytes — render time is the ESP's problem.
 */

const MAX_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 5_000

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

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(parsed.toString(), {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    })
    if (!res.ok) return { ok: false, error: 'not_reachable' }

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().startsWith('image/')) {
      return { ok: false, error: 'not_image' }
    }

    const lenHeader = res.headers.get('content-length')
    if (lenHeader) {
      const len = Number.parseInt(lenHeader, 10)
      if (Number.isFinite(len) && len > MAX_BYTES) {
        return { ok: false, error: 'too_large' }
      }
    }

    return { ok: true, url: parsed.toString() }
  } catch {
    return { ok: false, error: 'not_reachable' }
  } finally {
    clearTimeout(timeout)
  }
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
