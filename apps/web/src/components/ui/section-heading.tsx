import * as React from 'react'

import { cn } from '@/lib/utils'

export interface SectionHeadingProps {
  title: string
  description?: React.ReactNode
  className?: string
}

export function SectionHeading({
  title,
  description,
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn('mb-5', className)}>
      <h2 className="font-serif text-[22px] font-semibold tracking-tight text-[var(--fg-primary)]">
        {title}
      </h2>
      {description && (
        <p className="mt-1 max-w-[52ch] text-sm leading-normal text-[var(--fg-secondary)]">
          {description}
        </p>
      )}
    </div>
  )
}
