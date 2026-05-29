import * as React from 'react'

import { cn } from '@/lib/utils'

export interface RadioCardProps {
  selected: boolean
  onSelect: () => void
  icon?: React.ReactNode
  title: string
  description?: React.ReactNode
  /** Small pill to the right of the title, e.g. "Can get noisy". */
  note?: string
  className?: string
}

export function RadioCard({
  selected,
  onSelect,
  icon,
  title,
  description,
  note,
  className,
}: RadioCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-md border p-4 text-left transition-all',
        selected
          ? 'border-[var(--color-terracotta)] bg-[var(--bg-selected)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)]',
        className,
      )}
    >
      {icon && (
        <span
          className={cn(
            'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md [&_svg]:size-3.5',
            selected
              ? 'bg-[rgba(196,98,45,0.14)] text-[var(--color-terracotta)]'
              : 'bg-[rgba(140,123,107,0.1)] text-[var(--fg-secondary)]',
          )}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--fg-primary)]">
            {title}
          </span>
          {note && (
            <span className="rounded-full border border-[var(--border-subtle)] px-1.5 py-px text-[10px] font-medium text-[var(--fg-tertiary)]">
              {note}
            </span>
          )}
        </span>
        {description && (
          <span className="mt-0.5 block text-xs leading-snug text-[var(--fg-secondary)]">
            {description}
          </span>
        )}
      </span>
      <span
        className={cn(
          'mt-0.5 size-4 shrink-0 rounded-full transition-all',
          selected
            ? 'border-[5px] border-[var(--color-terracotta)]'
            : 'border-2 border-[rgba(140,123,107,0.4)]',
        )}
      />
    </button>
  )
}
