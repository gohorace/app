import * as React from 'react'

import { cn } from '@/lib/utils'

/** Small uppercase eyebrow label used at the top of settings cards. */
export function CardLabel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'mb-3.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--fg-secondary)]',
        className,
      )}
    >
      {children}
    </div>
  )
}
