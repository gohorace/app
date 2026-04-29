import { randomBytes } from 'crypto'

const CODE_ALPHABET = '0123456789ABCDEFGHIJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export function generateShortCode(length = 8): string {
  const buf = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length]
  return out
}

/**
 * Append the campaign tracking token (`_ri`) to a URL. Preserves any existing
 * query string. Falls back to plain string concat for non-absolute inputs.
 */
export function appendCampaignToken(url: string, token: string): string {
  if (!url) return url
  if (/^https?:\/\//i.test(url)) {
    try {
      const u = new URL(url)
      u.searchParams.set('_ri', token)
      return u.toString()
    } catch {
      // fall through to string mode
    }
  }
  return `${url}${url.includes('?') ? '&' : '?'}_ri=${encodeURIComponent(token)}`
}
