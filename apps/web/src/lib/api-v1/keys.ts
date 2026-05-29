/**
 * HOR-322 · Public API v1 — agency key minting.
 *
 * v1 keys are `hra_live_…`, distinct from MCP `hor_` tokens. Only the SHA-256
 * hash is stored (same as MCP); the plaintext is shown once at mint. `hint` is
 * the last 4 chars, stored for masked display in settings.
 */
import { createHash, randomBytes } from 'crypto'

const API_V1_KEY_PREFIX = 'hra_live_'

export function mintApiV1Key(): { plaintext: string; hash: string; hint: string } {
  const plaintext = API_V1_KEY_PREFIX + randomBytes(24).toString('base64url')
  const hash = createHash('sha256').update(plaintext).digest('hex')
  return { plaintext, hash, hint: plaintext.slice(-4) }
}

/** Masked display form from the stored hint, e.g. "hra_live_…a1b2". */
export function maskApiV1Key(hint: string | null): string {
  return `${API_V1_KEY_PREFIX}…${hint ?? '????'}`
}
