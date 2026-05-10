import type { ParseResult, ResendFetchedEmail } from '../types'
import { parseREA } from './rea'

/**
 * Dispatch a fetched email to the right portal-specific parser.
 *
 * The `source_portal` value comes from the webhook handler's
 * sender-domain heuristic (see `guessSourcePortal` in the webhook
 * route). Add new portals here as their parsers land.
 */
export function parseEmail(
  sourcePortal: string | null,
  fetched: ResendFetchedEmail,
): ParseResult {
  switch (sourcePortal) {
    case 'rea':
      return parseREA(fetched)
    case 'domain':
      // Deferred to a follow-up issue. Architecture is the same; only the
      // parser body differs. See HOR-63 → out of scope.
      return {
        error: 'unrecognised_format',
        detail: 'Domain parser not yet implemented',
      }
    default:
      return {
        error: 'unrecognised_format',
        detail: `No parser for source_portal=${sourcePortal ?? 'null'}`,
      }
  }
}

export { parseREA } from './rea'
