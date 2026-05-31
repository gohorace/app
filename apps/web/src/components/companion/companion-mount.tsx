'use client'

import { useCompanionInternal } from './companion-context'
import { CompanionTrigger } from './companion-trigger'
import { CompanionDrawer, type ActionAck } from './companion-drawer'
import type { CompanionAction } from '@/lib/companion/types'
import { actionConfirmation } from '@/lib/companion/respond'

/**
 * CompanionMount — single global mount for the Horace companion.
 * Mounted at the dashboard layout level next to NotificationsSlideOver.
 *
 * Owns:
 *  - showing/hiding the floating Quill trigger (hidden while the drawer
 *    is open),
 *  - calling the right backend per action kind on confirm,
 *  - injecting the moss-pill confirmation system message back into the
 *    drawer's thread.
 *
 * The thread itself lives inside `CompanionDrawer`; this component
 * doesn't store messages. To surface the confirmation we close + re-open
 * via the openCompanion path — too noisy. Instead the drawer renders
 * the system message itself as part of the `onAction` ack flow. Keep
 * that contract: this component returns a system text to the drawer,
 * the drawer appends it to its local thread.
 */

export function CompanionMount() {
  const { open, prompt, signal, edit, openToken, contextLabel, openCompanion, closeCompanion } =
    useCompanionInternal()

  async function handleAction(action: CompanionAction): Promise<ActionAck> {
    if (action.kind === 'dismiss') {
      const scope = action.scope ?? `companion:${action.target}`
      try {
        const res = await fetch('/api/companion/dismiss', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope, reason: action.reason ?? null }),
        })
        if (res.status === 503) {
          // Pre-migration — surface a soft moss-pill anyway; the agent
          // intent is recorded in the UI, the persistence catches up
          // once Andy applies 20260520000001.
          return { text: actionConfirmation(action), ok: false }
        }
        if (!res.ok) {
          return { text: 'That dismissal did not save — try again in a moment.', ok: false }
        }
      } catch (err) {
        console.error('[companion] dismiss failed:', err)
        return { text: 'That dismissal did not save — try again in a moment.', ok: false }
      }
      return { text: actionConfirmation(action), ok: true }
    }

    // The other three actions render the confirm card today but don't
    // call backend services yet — those wire in alongside their host
    // surfaces (digest cards in v2-M3, contact/property detail in
    // v2-M5/M6, inspections in v2-M8). Surface the moss pill so the
    // agent sees a clean ack; the action payload is logged for now.
    console.info('[companion] action confirmed (stubbed):', action)
    return { text: actionConfirmation(action), ok: true }
  }

  return (
    <>
      {!open && <CompanionTrigger onClick={() => openCompanion()} />}
      <CompanionDrawer
        open={open}
        contextLabel={contextLabel}
        prompt={prompt}
        signal={signal}
        edit={edit}
        openToken={openToken}
        onClose={closeCompanion}
        onAction={handleAction}
      />
    </>
  )
}
