/**
 * HOR-321 · Public API v1 — prefixed, reversible resource IDs.
 *
 * Internally every resource is a UUID. The public API exposes prefixed,
 * opaque-looking IDs (`con_…`, `prp_…`, `rel_…`) per the spec. Rather than
 * store a second column, we reversibly encode the UUID: base62 of its 128-bit
 * value, with the resource prefix. Deterministic, collision-free, and decodes
 * straight back to the UUID for queries — zero schema change.
 *
 *   encodeId('con', '8f3k…')  →  'con_<base62>'
 *   decodeId('con', 'con_…')  →  '8f3k…'  (or null if malformed / wrong prefix)
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = BigInt(ALPHABET.length)

export type ResourcePrefix = 'con' | 'prp' | 'rel'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uuidToBase62(uuid: string): string {
  const hex = uuid.replace(/-/g, '')
  let n = BigInt('0x' + hex)
  const ZERO = BigInt(0)
  if (n === ZERO) return '0'
  let out = ''
  while (n > ZERO) {
    out = ALPHABET[Number(n % BASE)] + out
    n = n / BASE
  }
  return out
}

function base62ToUuid(s: string): string | null {
  let n = BigInt(0)
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch)
    if (v < 0) return null
    n = n * BASE + BigInt(v)
  }
  // 128-bit value → 32 hex chars (left-padded). Reject anything wider.
  const hex = n.toString(16)
  if (hex.length > 32) return null
  const p = hex.padStart(32, '0')
  return `${p.slice(0, 8)}-${p.slice(8, 12)}-${p.slice(12, 16)}-${p.slice(16, 20)}-${p.slice(20)}`
}

export function encodeId(prefix: ResourcePrefix, uuid: string): string {
  return `${prefix}_${uuidToBase62(uuid)}`
}

/** Decode a public ID back to its UUID. Returns null if the prefix is wrong
 *  or the body doesn't decode to a valid 128-bit UUID. */
export function decodeId(prefix: ResourcePrefix, publicId: string): string | null {
  if (typeof publicId !== 'string') return null
  const head = `${prefix}_`
  if (!publicId.startsWith(head)) return null
  const body = publicId.slice(head.length)
  if (body.length === 0) return null
  const uuid = base62ToUuid(body)
  if (!uuid || !UUID_RE.test(uuid)) return null
  return uuid
}
