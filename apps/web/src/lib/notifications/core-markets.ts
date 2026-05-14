/**
 * Core Markets import-complete notification (HOR-193).
 *
 * Fires once per import when the worker transitions a core_market_imports
 * row from 'running' to 'complete'. Sends a web-push to every active
 * subscription for the agent and writes a notification_log row for
 * dedup + audit.
 *
 * Why this doesn't go through `dispatchPushAlert`:
 *   • It's not tied to a specific contact — `contact_id` is NULL.
 *   • It's a one-shot operational notification, not a behavioural
 *     alert — should NOT count against the 8/24h volume cap that
 *     dispatchPushAlert enforces.
 *   • The dedup boundary is the import job itself; the status
 *     transition (running → complete) is the dedup guarantee.
 *
 * The notification doesn't render in the in-app activity stream
 * (Slice A of HOR-130's stream filters out rows where contact_id is
 * null — see `derive-moment-type.ts`). Web-push is the user-facing
 * surface; the notification_log entry is for audit + future
 * "system events" UI.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { pushToAgent } from '@/lib/notifications/push'

interface ImportCompleteSummary {
  importId:     string
  agentId:      string
  localityName: string
  stateAbbrev:  string
  imported:     number
  matched:      number
}

export async function sendImportCompleteNotification(
  summary: ImportCompleteSummary,
): Promise<void> {
  const { importId, agentId, localityName, stateAbbrev, imported, matched } = summary

  const placeLabel = `${localityName}, ${stateAbbrev}`
  const importedStr = imported.toLocaleString('en-AU')

  // Body copy varies on whether any contacts auto-matched.
  // Matches docs/alerts-copy-standards.md tone: factual, no exclamation,
  // mention the locality + scope, hint at what to look for.
  const body = matched > 0
    ? `${importedStr} properties imported — ${matched.toLocaleString('en-AU')} already linked to a contact.`
    : `${importedStr} properties imported. Take a look in Properties.`

  await pushToAgent(agentId, {
    title: `${placeLabel} is on the map`,
    body,
    url:   '/properties',
    // Tagged by import id so a second tick of the same job (defensive,
    // shouldn't happen given the status transition) overwrites rather
    // than stacks on the device.
    tag:   `core-market-import-${importId}`,
  })

  const admin = createAdminClient()
  await admin.from('notification_log').insert({
    agent_id:   agentId,
    contact_id: null,
    // notification_log.type CHECK constraint was widened in HOR-192
    // (20260517000006) to include this value. The generated
    // database.types.ts union lags until the next regen — cast at
    // the insert site, same convention as push.ts:102.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type: 'core_markets_import_complete' as any,
    title: `${placeLabel} is on the map`,
    body,
    url:   '/properties',
  })
}
