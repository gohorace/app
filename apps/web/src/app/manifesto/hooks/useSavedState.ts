'use client'

import { useCallback, useEffect, useState } from 'react'
import { STORE_PROGRESS } from './useReadingProgress'

export const STORE_SAVED = 'horace-thesis:saved'

/** Save-to-read-later flag, persisted to localStorage. */
export function useSavedState() {
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    try {
      setSaved(localStorage.getItem(STORE_SAVED) === '1')
    } catch {}
  }, [])

  // Returns the new value so the caller can pick the right toast copy.
  const toggle = useCallback((): boolean => {
    let next = false
    setSaved((prev) => {
      next = !prev
      try {
        localStorage.setItem(STORE_SAVED, next ? '1' : '0')
      } catch {}
      return next
    })
    return next
  }, [])

  return { saved, toggle }
}

/**
 * The persisted scroll fraction, if it's worth offering a resume for
 * (between 6% and 92%, matching the prototype). Read once, on the client.
 */
export function getResumeFraction(): number | null {
  try {
    const v = parseFloat(localStorage.getItem(STORE_PROGRESS) || '0')
    if (v > 0.06 && v < 0.92) return v
  } catch {}
  return null
}
