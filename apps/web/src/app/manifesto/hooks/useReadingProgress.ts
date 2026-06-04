'use client'

import { RefObject, useEffect, useState } from 'react'

export const STORE_PROGRESS = 'horace-thesis:progress'

/**
 * Reading-progress bar + sticky-topbar border + scroll persistence.
 * Writes the fill width straight to `fillRef` inside a rAF (no re-render
 * per frame); `scrolled` only flips state at the 24px threshold.
 */
export function useReadingProgress(fillRef: RefObject<HTMLElement>) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const h = document.documentElement
        const max = h.scrollHeight - h.clientHeight
        const frac = max > 0 ? h.scrollTop / max : 0
        if (fillRef.current) fillRef.current.style.width = (frac * 100).toFixed(2) + '%'
        setScrolled(h.scrollTop > 24)
        try {
          localStorage.setItem(STORE_PROGRESS, String(frac))
        } catch {}
        ticking = false
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [fillRef])

  return { scrolled }
}
