/**
 * Derive a stream `MomentType` from a `notification_log` row + optional
 * contact context.
 *
 * Slice A: moment_type is computed at render time only — the underlying
 * `notification_log.type` column is channel-flavoured (alert/sms/email)
 * and doesn't carry the moment-shape the brief defines. Slice B will
 * add a `moment_type` column to the schema and these mappings move into
 * the emitter side; this helper deletes at that point.
 *
 * Returns `null` for rows that aren't stream-eligible (e.g. workspace
 * invite emails, audit-only volume_review markers). The page filters
 * these out before passing items to NotificationStream.
 */

import type { MomentType } from '@/components/notifications/moment-types'

export interface ContactContext {
  /** Most recent contact score; used as a tie-breaker for ambiguous types. */
  score?: number | null
  /** When the contact transitioned from anonymous → known (if known). */
  identified_at?: string | null
  /** Last engagement timestamp. */
  last_seen_at?: string | null
}

const NEWLY_KNOWN_WINDOW_MS = 24 * 60 * 60 * 1000

export function deriveMomentType(
  row: { type: string; sent_at: string; contact_id: string | null },
  contact?: ContactContext,
): MomentType | null {
  // Slice A scope: only contact-subject moments. Property-subject rows
  // (Worth watching, Ownership changed) aren't persisted yet — Slice B.
  if (!row.contact_id) return null

  switch (row.type) {
    case 'alert_form_submit':
    case 'alert_form':
    case 'sms_form':
      return 'high_intent'

    case 'alert_score_threshold':
    case 'alert_threshold':
    case 'sms_threshold':
      return 'high_intent'

    case 'alert_return_visit':
    case 'alert_return':
    case 'sms_return': {
      // Newly-known is a returning-visit row where the contact only
      // gained an identity in the last 24h. Otherwise it's a returning
      // moment for an already-known contact.
      const identifiedAt = contact?.identified_at
      if (identifiedAt) {
        const ageMs = Date.parse(row.sent_at) - Date.parse(identifiedAt)
        if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= NEWLY_KNOWN_WINDOW_MS) {
          return 'newly_known'
        }
      }
      return 'returning'
    }

    // Channel-only / audit rows — not stream-eligible.
    default:
      return null
  }
}
