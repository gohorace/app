'use client'

import type { CSSProperties } from 'react'
import type { Finding as FindingT } from '@/lib/audit/types'
import { BAND_LABEL, BAND_VAR } from '../copy'
import styles from '../audit.module.css'

/**
 * One finding block. Not a dashboard card — a barely-there surface with a soft
 * border. Band meaning is never colour alone: a coloured dot AND a text label
 * always render together (accessibility requirement from the handoff).
 */
export function Finding({ f, delay }: { f: FindingT; delay: number }) {
  const style = {
    '--bandc': BAND_VAR[f.band],
    '--d': `${delay}ms`,
  } as CSSProperties

  return (
    <div className={`${styles.finding} ${styles.rise}`} style={style} data-check={f.id}>
      <div className={styles.findingHead}>
        <span className={styles.band}>
          <span className={styles.bandDot} />
        </span>
        <h2>{f.name}</h2>
        <span className={styles.findingAside}>
          <span className={styles.bandLabel}>{BAND_LABEL[f.band]}</span>
        </span>
      </div>
      <p className={styles.findingBody}>{f.body}</p>
    </div>
  )
}
