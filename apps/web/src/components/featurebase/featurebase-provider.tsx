'use client'

import { FeaturebaseProvider } from 'featurebase-js/react'

/**
 * Boots the Featurebase Messenger SDK for the authenticated app.
 *
 * "Buttons only" install — `hideDefaultLauncher` suppresses Featurebase's
 * floating bubble, so the messenger only ever opens from our own UI (today:
 * the "Live chat" channel on /support, via `showNewMessage()`). The runtime
 * script (do.featurebase.app/js/sdk.js) is auto-injected by the SDK on first
 * use — no <Script> tag needed.
 *
 * Gated on `NEXT_PUBLIC_FEATUREBASE_APP_ID`: when it's unset (local dev that
 * hasn't been given the id, or any preview before it's configured) we render
 * children untouched and skip boot. The matching `messengerEnabled` check in
 * support-view.tsx keeps the Live-chat button on its mailto fallback in that
 * case, so nothing breaks before the id lands.
 *
 * Identity: anonymous works out of the box. When `featurebaseJwt` is passed
 * (minted server-side in the dashboard layout via lib/featurebase/jwt.ts),
 * conversations attribute to the signed-in agent. `featurebaseJwt` is
 * undefined when FEATUREBASE_JWT_SECRET isn't set → falls back to anonymous.
 */
export function FeaturebaseMessenger({
  children,
  featurebaseJwt,
}: {
  children: React.ReactNode
  featurebaseJwt?: string
}) {
  const appId = process.env.NEXT_PUBLIC_FEATUREBASE_APP_ID

  if (!appId) {
    return <>{children}</>
  }

  return (
    <FeaturebaseProvider appId={appId} featurebaseJwt={featurebaseJwt} hideDefaultLauncher>
      {children}
    </FeaturebaseProvider>
  )
}
