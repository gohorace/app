'use client'

import Image from 'next/image'
import styles from './step-pair.module.css'

/**
 * HOR-161 — the QR card on the desktop pair screen.
 *
 * Pure presentational — receives the server-generated QR data URL
 * and the human-readable URL, renders the card. The QR is generated
 * server-side (see /api/onboarding/pairing-token route) so this
 * component is just an Image wrapper.
 */
interface Props {
  qrDataUrl: string
  qrUrl: string
}

export function QRCard({ qrDataUrl, qrUrl }: Props) {
  // Show only the host on the card. The QR carries the full token;
  // the visible URL is a trust-signal ("yes, this is a Horace URL"),
  // not a debug surface. The 43-char base64url token rendered in
  // monospace under the QR read as noise rather than reassurance.
  const host = (() => {
    try {
      return new URL(qrUrl).host
    } catch {
      return qrUrl.replace(/^https?:\/\//, '').split('/')[0]
    }
  })()

  return (
    <div className={styles.qrCard}>
      <div className={styles.qrImageWrap}>
        <Image
          src={qrDataUrl}
          alt="Scan this code with your phone camera to pair Horace."
          width={256}
          height={256}
          className={styles.qrImage}
          unoptimized
          priority
        />
        <span className={styles.qrAccent} aria-hidden />
      </div>
      <div className={styles.qrCaption}>Scan with your phone camera</div>
      <div className={styles.qrSubCaption}>{host}</div>
    </div>
  )
}
