'use client'

import { useEffect, useState } from 'react'
import { Share, Home, Bell } from 'lucide-react'
import styles from './install.module.css'

/**
 * HOR-163 — iOS Safari install guide.
 *
 * Renders the Add-to-Home-Screen instructions in Safari browser
 * context. On iOS, push permission can only be requested from a
 * standalone PWA context — so this component intentionally does
 * NOT call requestPushPermission() at all. The push prompt is
 * surfaced via the dashboard standalone overlay (HOR-165), which
 * detects the pairing_active cookie + standalone display mode when
 * the user launches Horace from the home screen.
 *
 * If the user somehow gets to /m/[token]/install while ALREADY in
 * standalone mode (e.g. they re-opened the install link from the
 * PWA), we still show the instructions — they harmlessly explain
 * the same flow, and the dashboard overlay handles the actual push
 * permission ask on their next visit to /dashboard. Keeps the iOS
 * branch logic simple: one component, one rendering.
 *
 * Why not request push here in the (rare) standalone-on-install
 * path? Two reasons:
 *   1. Coupling. The PushPermissionPrompt component lives with the
 *      Android install flow (HOR-164) and the dashboard overlay
 *      (HOR-165). Pulling it in here means HOR-163 ships with a
 *      cross-cut dependency that adds review surface without
 *      meaningful behaviour change for the common case.
 *   2. UX consistency. iOS users see the prompt from the dashboard
 *      every time — same place, same component. Less to debug if
 *      something goes wrong on a specific device.
 */
export function IOSInstallGuide() {
  // Local detection — kept in state so SSR doesn't try to read
  // window. Used only for a small informational banner; the
  // instructions render in both cases.
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone === true
    setIsStandalone(standalone)
  }, [])

  return (
    <div className={styles.guide}>
      <ol className={styles.steps}>
        <li className={styles.step}>
          <span className={styles.stepBullet} aria-hidden>
            <Share size={16} />
          </span>
          <div className={styles.stepBody}>
            <div className={styles.stepTitle}>Tap the Share icon</div>
            <div className={styles.stepCopy}>
              At the bottom of Safari (or the top in landscape).
            </div>
          </div>
        </li>
        <li className={styles.step}>
          <span className={styles.stepBullet} aria-hidden>
            <Home size={16} />
          </span>
          <div className={styles.stepBody}>
            <div className={styles.stepTitle}>Add to Home Screen</div>
            <div className={styles.stepCopy}>
              Scroll down in the share sheet, then tap Add to Home Screen.
              Horace becomes a one-tap app.
            </div>
          </div>
        </li>
        <li className={styles.step}>
          <span className={styles.stepBullet} aria-hidden>
            <Bell size={16} />
          </span>
          <div className={styles.stepBody}>
            <div className={styles.stepTitle}>Open from home screen, allow push</div>
            <div className={styles.stepCopy}>
              Tap the Horace icon on your home screen. We&rsquo;ll ask for
              permission to send alerts — say yes to keep Horace in touch.
            </div>
          </div>
        </li>
      </ol>

      {isStandalone && (
        <div className={styles.standaloneBanner} role="status">
          You&rsquo;re running Horace as an installed app — nice. Open Horace
          from your home screen and we&rsquo;ll handle push permission there.
        </div>
      )}
    </div>
  )
}
