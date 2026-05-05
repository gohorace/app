import { randomBytes } from 'crypto'

const CODE_ALPHABET = '0123456789ABCDEFGHIJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export function generateShortCode(length = 8): string {
  const buf = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length]
  return out
}
