import * as React from 'react'

import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  icon?: React.ReactNode
  /** Display-font italic line, in Horace's voice. */
  quote?: string
  children?: React.ReactNode
  className?: string
}

export function EmptyState({ icon, quote, children, className }: EmptyStateProps) {
  return (
    <div className={cn('px-6 py-9 text-center', className)}>
      {icon && (
        <div className="mx-auto mb-3.5 flex size-11 items-center justify-center rounded-full bg-[rgba(140,123,107,0.1)] text-[var(--fg-secondary)] [&_svg]:size-5">
          {icon}
        </div>
      )}
      {quote && (
        <p className="mb-1.5 font-serif text-base italic text-[var(--fg-primary)]">
          {quote}
        </p>
      )}
      {children && (
        <p className="mx-auto max-w-[38ch] text-sm leading-normal text-[var(--fg-secondary)]">
          {children}
        </p>
      )}
    </div>
  )
}
