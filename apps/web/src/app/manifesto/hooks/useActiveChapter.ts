'use client'

import { useEffect, useState } from 'react'

/**
 * Tracks the chapter currently in the reading band via IntersectionObserver,
 * mirroring the prototype's `rootMargin: '-20% 0px -70% 0px'`. Returns the
 * active chapter id (or null) for ToC highlighting.
 */
export function useActiveChapter(ids: string[]) {
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el != null)
    if (!els.length) return

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) setActiveId(en.target.id)
        })
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [ids])

  return activeId
}
