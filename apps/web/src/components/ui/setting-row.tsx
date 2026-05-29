import * as React from 'react'

import { cn } from '@/lib/utils'

export interface SettingRowProps {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  /** Right-aligned control(s). */
  children?: React.ReactNode
  /** Drop the bottom divider for the last row in a list. */
  last?: boolean
  className?: string
}

export function SettingRow({
  icon,
  title,
  description,
  children,
  last,
  className,
}: SettingRowProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3.5 px-4 py-3.5',
        !last && 'border-b border-[var(--border-subtle)]',
        className,
      )}
    >
      {icon && (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[rgba(140,123,107,0.08)] text-[var(--fg-secondary)] [&_svg]:size-3.5">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[var(--fg-primary)]">{title}</div>
        {description && (
          <div className="mt-0.5 text-xs leading-snug text-[var(--fg-secondary)]">
            {description}
          </div>
        )}
      </div>
      {children && (
        <div className="flex shrink-0 items-center gap-2.5">{children}</div>
      )}
    </div>
  )
}
