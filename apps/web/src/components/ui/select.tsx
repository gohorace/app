import * as React from 'react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Convenience: render `<option>`s from data. Falls back to `children`. */
  options?: SelectOption[]
  /** className for the wrapper; pass `selectClassName` to style the control. */
  wrapperClassName?: string
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, wrapperClassName, options, children, ...props }, ref) => (
    <div className={cn('relative w-full', wrapperClassName)}>
      <select
        ref={ref}
        className={cn(
          'h-10 w-full appearance-none rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] pl-3 pr-8 text-sm text-[var(--fg-primary)] ring-offset-[var(--bg-page)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {options
          ? options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
          : children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--fg-secondary)]" />
    </div>
  ),
)
Select.displayName = 'Select'

export { Select }
