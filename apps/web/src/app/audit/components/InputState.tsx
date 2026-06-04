'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { isValidDomain, cleanDomain } from '@/lib/audit/domain'
import { COPY } from '../copy'
import styles from '../audit.module.css'

const MARK = '/horace-charcoal.png'

export function InputState({
  onSubmit,
  leaving,
  initialValue = '',
  initialError = '',
  socialProof,
}: {
  onSubmit: (domain: string) => void
  leaving: boolean
  initialValue?: string
  initialError?: string
  /** Only rendered if live aggregate data actually exists (per handoff). */
  socialProof?: string
}) {
  const [val, setVal] = useState(initialValue)
  const [err, setErr] = useState(initialError)
  const inputRef = useRef<HTMLInputElement>(null)
  const valid = isValidDomain(val)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = () => {
    if (!isValidDomain(val)) {
      setErr(COPY.input.invalid)
      return
    }
    setErr('')
    onSubmit(cleanDomain(val))
  }

  return (
    <div className={`${styles.hero} ${leaving ? styles.fadeOut : ''}`}>
      <Image className={styles.mark} src={MARK} alt="Horace" width={54} height={54} priority />
      <h1 className={styles.headline}>{COPY.input.headline}</h1>
      <p className={styles.subhead}>{COPY.input.subhead}</p>

      <div className={styles.form}>
        <div>
          <div className={styles.fieldShell}>
            <input
              ref={inputRef}
              className={`${styles.field} ${valid ? styles.valid : ''}`}
              type="text"
              inputMode="url"
              autoComplete="url"
              aria-label="Your website address"
              placeholder={COPY.input.placeholder}
              value={val}
              onChange={(e) => {
                setVal(e.target.value)
                if (err) setErr('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
            <Check className={styles.tick} aria-hidden="true" />
          </div>
          <div className={styles.err} role="alert" style={{ marginTop: err ? 10 : 0 }}>
            {err}
          </div>
        </div>
        <button
          className={`${styles.btn} ${styles.btnPrimary} ${styles.btnBlock}`}
          onClick={submit}
          disabled={!valid}
        >
          {COPY.input.cta}
        </button>
        <p className={styles.reassure}>{COPY.input.reassurance}</p>
      </div>

      {socialProof ? <p className={styles.belowfold}>{socialProof}</p> : null}
    </div>
  )
}
