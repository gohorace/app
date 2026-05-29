import * as React from 'react'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface ChipProps {
  children: React.ReactNode
  onRemove?: () => void
  className?: string
}

export function Chip({ children, onRemove, className }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md bg-[rgba(140,123,107,0.12)] px-2 py-1 text-xs font-medium text-[var(--fg-primary)]',
        className,
      )}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="flex text-[var(--fg-tertiary)] transition-colors hover:text-[var(--fg-primary)]"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}
