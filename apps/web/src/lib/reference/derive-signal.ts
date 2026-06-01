import 'server-only'
import type { SignalValue } from '@/components/reference/types'
import type { PersistedRoleType } from '@/lib/contacts/roles'

/**
 * Signal derivation for the reference (substrate) tables.
 *
 * The 5 design signal values aren't stored anywhere — they're derived here,
 * in ONE place, from real behavioural data. Tune the bands below to change how
 * the substrate classifies intent everywhere.
 *
 * Grounded in the app's existing score bands (`lib/design/intent.ts`:
 * >=50 high, >=20 mid) plus the persisted contact role (seller/landlord =
 * vendor-side, buyer = buyer-side).
 *
 *   score >= 50   vendor → pre-appraisal   ·   buyer → high intent
 *   score >= 20   vendor → benchmarking    ·   buyer → serious buyer
 *   score <  20   watching
 */
export function deriveContactSignal(
  score: number,
  roleTypes: PersistedRoleType[],
): SignalValue {
  const isVendor = roleTypes.includes('seller') || roleTypes.includes('landlord')
  if (score >= 50) return isVendor ? 'pre-appraisal' : 'high intent'
  if (score >= 20) return isVendor ? 'benchmarking' : 'serious buyer'
  return 'watching'
}

/**
 * A property's top_signal = the strongest buyer intent currently looking at it,
 * derived from the highest score among its known 7-day viewers (role-agnostic,
 * since viewers are predominantly buyers). Properties with no identified viewer
 * read as `watching`.
 *
 *   top viewer score >= 50 → high intent
 *   top viewer score >= 20 → serious buyer
 *   else                   → watching
 */
export function derivePropertySignal(topViewerScore: number): SignalValue {
  if (topViewerScore >= 50) return 'high intent'
  if (topViewerScore >= 20) return 'serious buyer'
  return 'watching'
}
