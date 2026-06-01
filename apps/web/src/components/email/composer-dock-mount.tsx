'use client'

import { useComposerDockInternal } from './composer-dock-context'
import { ComposerDock, useIsMobile } from './composer-dock'
import { useCompanion } from '@/components/companion/companion-context'

/**
 * Right-anchored Companion footprint to clear (HOR-361):
 *   • rail open  → 460px drawer (companion-drawer.tsx: md:w-[460px])
 *   • rail closed → 50px quill trigger at right:24 (companion-trigger.tsx)
 */
const COMPANION_RAIL_PX = 460
const COMPANION_TRIGGER_CLEAR_PX = 24 + 50 // trigger right inset + width
const GAP_PX = 16
const DOCK_WIDTH_PX = 420

/**
 * ComposerDockMount — single global mount for the tracked-email composer docks
 * (HOR-354 / HOR-361). Mounted in the dashboard layout inside
 * `ComposerDockProvider`, alongside `CompanionMount`.
 *
 * Renders every open dock, stacking them leftward (Gmail-style): the first
 * dock is anchored just left of the Companion (trigger or open rail) so it
 * never overlaps it; each subsequent send sits one dock-width further left.
 *
 * On mobile only the most-recently-opened dock shows (as the full-width bottom
 * sheet) — stacking side-by-side doesn't fit a phone.
 */
export function ComposerDockMount() {
  const { entries, closeComposer } = useComposerDockInternal()
  const { open: companionOpen } = useCompanion()
  const mobile = useIsMobile()

  if (entries.length === 0) return null

  const base = (companionOpen ? COMPANION_RAIL_PX : COMPANION_TRIGGER_CLEAR_PX) + GAP_PX
  const visible = mobile ? entries.slice(-1) : entries

  return (
    <>
      {visible.map((entry) => {
        const index = entries.indexOf(entry)
        return (
          <ComposerDock
            key={entry.id}
            payload={entry.payload}
            focusNonce={entry.focusNonce}
            rightOffset={base + index * (DOCK_WIDTH_PX + GAP_PX)}
            onClose={() => closeComposer(entry.id)}
          />
        )
      })}
    </>
  )
}
