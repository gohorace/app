import * as React from 'react'

import { cn } from '@/lib/utils'

export interface SegmentedOption {
  value: string
  label: React.ReactNode
}

export interface SegmentedProps {
  value: string
  onValueChange: (value: string) => void
  options: SegmentedOption[]
  size?: 'sm' | 'md'
  className?: string
}

export function Segmented({
  value,
  onValueChange,
  options,
  size = 'md',
  className,
}: SegmentedProps) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex gap-0.5 rounded-md bg-[rgba(140,123,107,0.1)] p-0.5',
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange(o.value)}
            className={cn(
              'whitespace-nowrap rounded-[5px] font-medium transition-all',
              size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-sm',
              active
                ? 'bg-[var(--bg-elevated)] text-[var(--fg-primary)] shadow-[var(--shadow-xs)]'
                : 'text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
